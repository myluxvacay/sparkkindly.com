// The circle set, scores and interests pages (plan 4C) as plain loaders, plus the interests POST, in the style of web.ts.
// With ACCOUNTS_ENABLED or CIRCLES_ENABLED off everything is not_found (a 404). The viewer comes only from getContext:
// the account holder, or the active child profile, which may read the set and scores of circles it currently belongs
// to and nothing else (interests is 'child', every write 403 through asAdult). A non-member gets not_found, so whether
// a circle exists does not leak. Nothing returned carries an email, an id of another member, or a chosen answer.
// Verified by tests/unit/circles-play-web.test.ts.
import { seeOther } from '@/lib/admin/guard';
import { getContext } from '@/lib/accounts/context';
import { interestChoices } from '@/lib/accounts/interests';
import { circlesEnabled } from '@/lib/config';
import type { Db, Queryable } from '@/lib/db';
import { circleDay, circleForViewer, getOrCreateDailySet, readSet, type SetItem, type ViewerCircle } from './daily-set';
import { getCircleInterests, setCircleInterests, type CircleInterests } from './interests';
import { getTallies, type Tallies } from './scores';
import { myRole } from './repo';
import { scoped, type CircleDeps } from './web';

type Missing = { status: 'not_found' | 'sign_in' };
type Named = { name: string; slug: string };
export type AnswerState = 'answered' | 'earlier' | 'not_yet';
export type SetPage = Missing | { status: 'ok'; circle: Named; day: string; items: (SetItem & { state: AnswerState })[] };
export type ScoresPage = Missing | { status: 'ok'; circle: Named; tallies: Tallies };
export type InterestsPage =
  | Missing
  | { status: 'child' }
  | { status: 'ok'; circle: Named; isOwner: boolean; open: boolean; interests: CircleInterests; choices: Awaited<ReturnType<typeof interestChoices>> };

type Viewer = { accountId: string; profileId: string | null; circle: ViewerCircle };

// The signed-in viewer and the circle they are a current member of, or the reason there is none.
async function viewerOf(db: Db, token: string, slug: string, now: Date): Promise<Viewer | Missing> {
  if (!circlesEnabled()) return { status: 'not_found' };
  const ctx = await getContext(db, token, now);
  if (!ctx) return { status: 'sign_in' };
  const profileId = ctx.profile?.id ?? null;
  const circle = await circleForViewer(db, ctx.account.id, profileId, slug);
  return circle ? { accountId: ctx.account.id, profileId, circle } : { status: 'not_found' };
}

const named = (c: ViewerCircle): Named => ({ name: c.name, slug: c.slug });

// Per item: answered within today's circle day, answered on another day (it does not score today), or not yet.
async function answerStates(q: Queryable, v: Viewer, day: string, items: SetItem[]): Promise<Map<string, AnswerState>> {
  const r = await q.query<{ item_id: string; d: string }>(
    `SELECT item_id, to_char(answered_at AT TIME ZONE $4::text, 'YYYY-MM-DD') AS d FROM item_responses
     WHERE account_id = $1 AND profile_id IS NOT DISTINCT FROM $2::uuid AND item_id = ANY($3::uuid[])`,
    [v.accountId, v.profileId, items.map((i) => i.itemId), v.circle.timeZone],
  );
  return new Map(r.rows.map((x): [string, AnswerState] => [x.item_id, x.d === day ? 'answered' : 'earlier']));
}

export async function loadSetPage(db: Db, token: string, slug: string, now: Date): Promise<SetPage> {
  const v = await viewerOf(db, token, slug, now);
  if ('status' in v) return v;
  const day = circleDay(v.circle.timeZone, now);
  const items = await getOrCreateDailySet(db, v.circle.id, now);
  const states = await answerStates(db, v, day, items);
  return { status: 'ok', circle: named(v.circle), day, items: items.map((i) => ({ ...i, state: states.get(i.itemId) ?? 'not_yet' })) };
}

export async function loadScoresPage(db: Db, token: string, slug: string, now: Date): Promise<ScoresPage> {
  const v = await viewerOf(db, token, slug, now);
  if ('status' in v) return v;
  const tallies = await getTallies(db, v.accountId, v.profileId, slug, now);
  return tallies ? { status: 'ok', circle: named(v.circle), tallies } : { status: 'not_found' };
}

export async function loadInterestsPage(db: Db, token: string, slug: string): Promise<InterestsPage> {
  const now = new Date();
  const v = await viewerOf(db, token, slug, now);
  if ('status' in v) return v;
  if (v.profileId !== null) return { status: 'child' };
  const interests = await getCircleInterests(db, v.accountId, slug);
  if (!interests) return { status: 'not_found' };
  const isOwner = (await myRole(db, v.circle.id, v.accountId)) === 'owner';
  return { status: 'ok', circle: named(v.circle), isOwner, open: v.circle.status === 'open', interests, choices: await interestChoices(db) };
}

// Today's set size and how many of it the account holder answered today, for the circle page; null for a non-member.
// Read only: it never makes the set (opening the set page does), so an owner can pick interests first.
export async function loadSetStatus(db: Db, accountId: string, slug: string, now: Date): Promise<{ items: number; answered: number } | null> {
  const circle = await circleForViewer(db, accountId, null, slug);
  if (!circle) return null;
  const day = circleDay(circle.timeZone, now);
  const items = await readSet(db, circle.id, day, now);
  const states = await answerStates(db, { accountId, profileId: null, circle }, day, items);
  return { items: items.length, answered: [...states.values()].filter((s) => s === 'answered').length };
}

// A field that is not a whole number stays NaN, which setCircleInterests refuses.
const numbers = (form: URLSearchParams, name: string) => form.getAll(name).map((x) => (/^\d+$/.test(x) ? Number(x) : NaN));
const CODES = { saved: 'saved', invalid: 'invalid', not_owner: 'not-owner', closed: 'read-only' } as const;

export const saveCircleInterestsRequest = (request: Request, d: CircleDeps, slug: string) =>
  scoped(request, d, slug, async (accountId, form) => {
    const r = await setCircleInterests(d.db, accountId, slug, { worldIds: numbers(form, 'world'), topicIds: numbers(form, 'topic') });
    return seeOther(`/circles/${slug}/interests/?r=${CODES[r]}#result`);
  });
