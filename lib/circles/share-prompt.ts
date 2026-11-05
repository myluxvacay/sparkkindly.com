// Growth prompts after an answer (plan 4D, spec Project 4 "Growth loop"). For an adult-context member who answered an
// item that is in today's set (the circle's local day, re-filtered with the circle's current audiences) of one or more
// of their open, visible circles: "Invite someone to <circle>" (the circle page's invite section, only where they may
// invite) and "Share this game" (the item's public URL, nothing appended). Null for anonymous visitors, a child context,
// Kids world items, circles off, or an item in none of their circles' sets today. No URL carries a circle id, a member
// or an account. No Next.js imports. Verified by tests/unit/circles-share-prompt.test.ts.
import type { AccountContext } from '@/lib/accounts/context';
import { isUuid } from '@/lib/accounts/pin';
import { ageGroupFor, can, type Consent } from '@/lib/accounts/policy';
import { circlesEnabled } from '@/lib/config';
import type { Db } from '@/lib/db';
import { circleHasChild } from './children';
import { CHILD_DAY_SAFE, PLAYABLE, circleAudiences } from './daily-set';

export type SharePrompt = { circles: { name: string; inviteHref: string }[]; shareUrl: string };
type InSet = { id: string; name: string; slug: string; role: 'owner' | 'member'; day: string };

async function circlesWithItem(db: Db, accountId: string, itemId: string, now: Date): Promise<InSet[]> {
  const r = await db.query<InSet>(
    `SELECT c.id, c.name, c.slug, m.role, s.day::text AS day FROM circle_members m JOIN circles c ON c.id = m.circle_id
     JOIN circle_daily_sets s ON s.circle_id = c.id AND s.item_id = $2
       AND s.day = ($3::timestamptz AT TIME ZONE c.time_zone)::date
     WHERE m.account_id = $1 AND m.profile_id IS NULL AND m.left_at IS NULL AND c.status = 'open' AND c.hidden_at IS NULL
     ORDER BY c.name, c.slug`,
    [accountId, itemId, now.toISOString()],
  );
  return r.rows;
}

// The item as this circle's members may see it in today's set now (current audiences and the day's child-day rule,
// as readSet applies them), or null.
async function visibleIn(db: Db, c: InSet, itemId: string, now: Date) {
  const r = await db.query<{ slug: string; world: string }>(
    `SELECT i.slug, w.slug AS world FROM circle_daily_sets s JOIN items i ON i.id = s.item_id JOIN worlds w ON w.id = i.world_id
     WHERE s.circle_id = $4 AND s.day = $5::date AND i.id = $3 AND ${PLAYABLE} AND ${CHILD_DAY_SAFE}`,
    [now, [...(await circleAudiences(db, c.id))], itemId, c.id, c.day],
  );
  return r.rows[0] ?? null;
}

async function mayInvite(db: Db, accountId: string, c: InSet, now: Date): Promise<boolean> {
  const a = await db.query<{ dob: string; consent_state: Consent }>(
    "SELECT to_char(date_of_birth, 'YYYY-MM-DD') AS dob, consent_state FROM accounts WHERE id = $1",
    [accountId],
  );
  const group = a.rows[0] ? ageGroupFor(a.rows[0].dob, now) : null;
  if (!group || !can(group, a.rows[0].consent_state, 'invite')) return false;
  // In a circle holding a child profile only the owner invites (4B ruling).
  return c.role === 'owner' || !(await circleHasChild(db, c.id));
}

export async function sharePromptFor(
  db: Db,
  ctx: AccountContext | null,
  itemId: string,
  now: Date,
  base: string,
): Promise<SharePrompt | null> {
  if (!circlesEnabled() || !ctx || ctx.profile || !isUuid(itemId)) return null;
  let item: { slug: string; world: string } | null = null;
  const circles: SharePrompt['circles'] = [];
  for (const c of await circlesWithItem(db, ctx.account.id, itemId, now)) {
    const seen = await visibleIn(db, c, itemId, now);
    if (!seen || seen.world === 'kids') continue;
    item = seen;
    if (await mayInvite(db, ctx.account.id, c, now)) circles.push({ name: c.name, inviteHref: `/circles/${c.slug}/#invites` });
  }
  return item ? { circles, shareUrl: `${base}/${item.world}/${item.slug}/` } : null;
}
