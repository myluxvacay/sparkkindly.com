// Public communities (plan 4B, spec Project 4 "Invites"): the public listing of open, visible community circles (name,
// description and member count, never member names) and joining one without an invite, under the shared join rules
// (lib/circles/join.ts: 13-15 accounts cannot join a community; friends and family circles are invite-only).
// No Next.js imports. Verified by tests/unit/circles-join.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { joinLocked, type JoinResult, type LockedCircle } from './join';
import { cleanMemberName } from './rules';
import { isSlug } from './repo';

export const COMMUNITY_PAGE = 20;
const MAX_PAGE = 1000;

export type CommunitySummary = { name: string; slug: string; description: string | null; memberCount: number };

export async function listCommunities(db: Queryable, page: number): Promise<CommunitySummary[]> {
  const p = Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1;
  const r = await db.query<{ name: string; slug: string; description: string | null; n: number }>(
    `SELECT c.name, c.slug, c.description,
            (SELECT count(*)::int FROM circle_members m WHERE m.circle_id = c.id AND m.left_at IS NULL) AS n
     FROM circles c WHERE c.kind = 'community' AND c.status = 'open' AND c.hidden_at IS NULL
     ORDER BY c.created_at DESC, c.slug LIMIT $1 OFFSET $2`,
    [COMMUNITY_PAGE, (p - 1) * COMMUNITY_PAGE],
  );
  return r.rows.map((c) => ({ name: c.name, slug: c.slug, description: c.description, memberCount: c.n }));
}

export async function joinCommunity(db: Db, accountId: string, slug: string, yourName: unknown, now: Date): Promise<JoinResult> {
  const name = cleanMemberName(yourName);
  if (!name) return { status: 'name' };
  if (!isSlug(slug)) return { status: 'closed' };
  return db.transaction(async (tx) => {
    const r = await tx.query<LockedCircle>('SELECT id, slug, kind, status, hidden_at FROM circles WHERE slug = $1 FOR UPDATE', [
      slug,
    ]);
    return r.rows[0] ? joinLocked(tx, accountId, r.rows[0], name, false, now) : { status: 'closed' };
  });
}
