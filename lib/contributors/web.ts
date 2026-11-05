// The contributor editor's POSTs and page loader (plan 8 Task 4) as plain functions, in the style of lib/comments/web.ts.
// With ACCOUNTS_ENABLED or CONTRIBUTORS_ENABLED off every route is a 404. Each POST checks Origin first and takes the
// account only from the session's adult context (no session goes to sign-in, a child context gets 403); any account id
// or other field in the form beyond the draft's own fields is never read. Redirects carry an outcome code and, after a
// save, the contribution's own id. No Next.js imports. Verified by tests/unit/contributors-web.test.tsx.
import { readCookie, readForm, sameOrigin, seeOther } from '@/lib/admin/guard';
import { getContext, requireAdultContext, type AdultContext } from '@/lib/accounts/context';
import { isUuid } from '@/lib/accounts/pin';
import { can, type AgeGroup } from '@/lib/accounts/policy';
import { ACCOUNT_COOKIE, forbidden } from '@/lib/accounts/web';
import { contributorsEnabled } from '@/lib/config';
import type { Db } from '@/lib/db';
import { getMine, listMine, saveDraft, type Mine } from './drafts';
import { enableContributor, getProfile, type Profile } from './profile';
import { CONTRIBUTOR_LIMITS } from './rules';
import { submitContribution, withdraw } from './submit';

export type WebDeps = { db: Db; now: Date };

const PAGE = '/me/contribute/';
const MAX_FORM_BYTES = 96 * 1024; // 8,000 characters of text can grow several times when percent-encoded
const notFound = () => new Response('Not found', { status: 404 });
const result = (code: string, id?: string) => seeOther(`${PAGE}?${id ? `id=${id}&` : ''}r=${code}#result`);

async function asContributor(request: Request, d: WebDeps, act: (ctx: AdultContext, form: URLSearchParams) => Promise<Response>): Promise<Response> {
  if (!contributorsEnabled()) return notFound();
  if (!sameOrigin(request)) return forbidden();
  const ctx = await getContext(d.db, readCookie(request, ACCOUNT_COOKIE), d.now);
  if (!ctx) return seeOther('/account/sign-in/');
  const adult = requireAdultContext(ctx);
  if (!adult) return forbidden();
  const form = await readForm(request, MAX_FORM_BYTES);
  if (!form) return new Response('Payload too large or not a form', { status: 413 });
  return act(adult, form);
}

const rows = (form: URLSearchParams, prefix: string, fields: string[], max: number) =>
  Array.from({ length: max }, (_, i) => Object.fromEntries(fields.map((f) => [f, (form.get(`${prefix}_${f}_${i}`) ?? '').trim()])))
    .filter((r) => Object.values(r).some(Boolean));

// The draft fields from the form, and nothing else.
export function draftFromForm(form: URLSearchParams): Record<string, unknown> {
  const options = Array.from({ length: CONTRIBUTOR_LIMITS.options }, (_, i) => form.get(`option_${i}`) ?? '');
  return {
    id: form.get('id') || undefined,
    kind: form.get('kind'),
    world: form.get('world'),
    title: form.get('title') ?? '',
    summary: form.get('summary') ?? '',
    topics: form.getAll('topic'),
    sources: rows(form, 'source', ['title', 'url'], CONTRIBUTOR_LIMITS.sources),
    sections: rows(form, 'section', ['heading', 'text'], CONTRIBUTOR_LIMITS.maxSections),
    takeaway: form.get('takeaway') ?? '',
    question: form.get('question') ?? '',
    options: form.get('kind') === 'quiz' ? options : [],
    correct: form.get('correct') ?? '0',
    explanation: form.get('explanation') ?? '',
  };
}

export const enableRequest = (request: Request, d: WebDeps) =>
  asContributor(request, d, async (ctx, form) => {
    const r = await enableContributor(
      d.db,
      ctx,
      { displayName: form.get('display_name'), bio: form.get('bio') ?? undefined, link: form.get('link') ?? undefined, terms: form.get('terms') ?? undefined },
      d.now,
    );
    return result(r.status === 'enabled' ? 'enabled' : r.code);
  });

export const saveRequest = (request: Request, d: WebDeps) =>
  asContributor(request, d, async (ctx, form) => {
    const r = await saveDraft(d.db, ctx, draftFromForm(form), d.now);
    if (r.status === 'saved') return result('saved', r.id);
    const id = form.get('id');
    return result(r.code, r.code !== 'not_found' && isUuid(id) ? id : undefined);
  });

export const submitRequest = (request: Request, d: WebDeps) =>
  asContributor(request, d, async (ctx, form) => {
    const id = form.get('id');
    const r = await submitContribution(d.db, ctx, id, { original: form.get('original'), licence: form.get('licence') }, d.now);
    const code = r.status === 'refused' ? r.code : r.status;
    return result(code, code !== 'not_found' && isUuid(id) ? id : undefined);
  });

export const withdrawRequest = (request: Request, d: WebDeps) =>
  asContributor(request, d, async (ctx, form) => result(await withdraw(d.db, ctx, form.get('id'), d.now)));

export type ContributePage = {
  profile: Profile | null;
  group: AgeGroup;
  mine: Mine[];
  editing: Mine | null;
  newKind: 'article' | 'quiz' | null;
  worlds: { slug: string; name: string }[];
  topics: { slug: string; name: string }[];
};

// What /me/contribute/ shows the signed-in adult context, or 'not_found' (cannot contribute, or ?id is not theirs).
export async function loadContributePage(db: Db, ctx: AdultContext, q: { id?: string; new?: string }): Promise<ContributePage | 'not_found'> {
  const group = ctx.account.ageGroup;
  if (!can(group, ctx.account.consent, 'contribute')) return 'not_found';
  const editing = q.id ? await getMine(db, ctx.account.id, q.id) : null;
  if (q.id && !editing) return 'not_found';
  const worlds = await db.query<{ slug: string; name: string }>("SELECT slug, name FROM worlds WHERE enabled AND slug <> 'kids' ORDER BY sort, slug");
  const topics = await db.query<{ slug: string; name: string }>('SELECT slug, name FROM topics ORDER BY name, slug');
  return {
    profile: await getProfile(db, ctx.account.id),
    group,
    mine: await listMine(db, ctx.account.id),
    editing,
    newKind: q.new === 'article' || q.new === 'quiz' ? q.new : null,
    worlds: worlds.rows,
    topics: topics.rows,
  };
}

// Outcome messages for ?r=. Only these codes ever show text.
export const CONTRIBUTE_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  enabled: { text: 'Your contributor profile is saved.', ok: true },
  saved: { text: 'Your draft is saved. Only you can see it.', ok: true },
  agent_review: { text: 'Thank you. Your piece passed the automatic checks and is waiting for review.', ok: true },
  withdrawn: { text: 'Your piece is withdrawn. If it was published, it has been taken down.', ok: true },
  gates_failed: { text: 'Your piece did not pass the automatic checks yet. The reasons are listed with it below.', ok: false },
  not_allowed: { text: 'Contributing is open to signed-in members aged 16 and over.', ok: false },
  banned: { text: 'Your account can no longer contribute.', ok: false },
  no_profile: { text: 'Please switch on your contributor profile first.', ok: false },
  terms: { text: 'Please accept the contributor terms.', ok: false },
  name: { text: 'Please choose a display name of 1 to 30 characters, without an @ or a link.', ok: false },
  bio: { text: 'A bio has at most 140 characters and no links.', ok: false },
  link: { text: 'A link must start with https://. Contributors aged 16 and 17 cannot add a link.', ok: false },
  rate: { text: 'You have done that a lot recently. Please try again later.', ok: false },
  invalid: { text: 'Please check the form: a field is too long or not in the allowed format.', ok: false },
  draft_limit: { text: `You can keep up to ${CONTRIBUTOR_LIMITS.drafts} drafts. Submit or withdraw one first.`, ok: false },
  pending_limit: { text: `You can have up to ${CONTRIBUTOR_LIMITS.pending} pieces waiting at once.`, ok: false },
  declarations: { text: 'Please tick both boxes: your own work, and the licence.', ok: false },
  kids: { text: 'Kids items are written by the SparkKindly team only.', ok: false },
  item_locked: { text: 'The kind and world of a submitted piece cannot be changed. Start a new piece instead.', ok: false },
  wrong_state: { text: 'That piece cannot be changed right now.', ok: false },
  changed: { text: 'That piece changed while it was being checked. Please submit it again.', ok: false },
  not_found: { text: 'That piece was not found.', ok: false },
};
