// Circle interests (plan 4C): the topics and worlds a circle's daily set is drawn from. Only the owner (the session's
// account, re-checked under the circle row lock) saves them; ids are validated against existing topics and enabled
// worlds; a save replaces the whole set. Current account members read them. No Next.js imports.
// Verified by tests/unit/circles-interests.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { isUuid } from '@/lib/accounts/pin';
import { asOwner } from './owner';
import { isSlug, myRole } from './repo';

export const INTEREST_LIMITS = { topics: 10, worlds: 5 } as const;
export type CircleInterests = { worldIds: number[]; topicIds: number[] };
export type SaveResult = 'saved' | 'not_owner' | 'invalid' | 'closed';

// Positive int4 values, no duplicates, at most `max`; otherwise null.
function cleanIds(v: unknown, max: number): number[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  if (!v.every((x) => Number.isSafeInteger(x) && x > 0 && x <= 2_147_483_647)) return null;
  return new Set(v).size === v.length ? (v as number[]) : null;
}

async function allExist(tx: Queryable, i: CircleInterests): Promise<boolean> {
  const t = await tx.query('SELECT id FROM topics WHERE id = ANY($1::int[])', [i.topicIds]);
  const w = await tx.query('SELECT id FROM worlds WHERE enabled AND id = ANY($1::int[])', [i.worldIds]);
  return t.rows.length === i.topicIds.length && w.rows.length === i.worldIds.length;
}

export async function setCircleInterests(
  db: Db,
  ownerId: string,
  slug: string,
  input: { worldIds: unknown; topicIds: unknown },
): Promise<SaveResult> {
  if (!isUuid(ownerId)) return 'not_owner';
  return db.transaction(async (tx) => {
    const c = await asOwner(tx, ownerId, slug);
    if (typeof c === 'string') return c;
    const worldIds = cleanIds(input.worldIds, INTEREST_LIMITS.worlds);
    const topicIds = cleanIds(input.topicIds, INTEREST_LIMITS.topics);
    if (!worldIds || !topicIds || !(await allExist(tx, { worldIds, topicIds }))) return 'invalid';
    await tx.query('DELETE FROM circle_interests WHERE circle_id = $1', [c.id]);
    await tx.query('INSERT INTO circle_interests (circle_id, topic_id) SELECT $1, x FROM unnest($2::int[]) AS x', [c.id, topicIds]);
    await tx.query('INSERT INTO circle_interests (circle_id, world_id) SELECT $1, x FROM unnest($2::int[]) AS x', [c.id, worldIds]);
    return 'saved';
  });
}

// A circle's interests by id (trusted: callers have resolved the circle from a membership).
export async function interestsOf(q: Queryable, circleId: string): Promise<CircleInterests> {
  const r = await q.query<{ topic_id: number | null; world_id: number | null }>(
    'SELECT topic_id, world_id FROM circle_interests WHERE circle_id = $1 ORDER BY topic_id, world_id',
    [circleId],
  );
  return {
    worldIds: r.rows.flatMap((x) => (x.world_id === null ? [] : [x.world_id])),
    topicIds: r.rows.flatMap((x) => (x.topic_id === null ? [] : [x.topic_id])),
  };
}

// Null unless the account is a current member of the (visible) circle.
export async function getCircleInterests(db: Queryable, accountId: string, slug: string): Promise<CircleInterests | null> {
  if (!isUuid(accountId) || !isSlug(slug)) return null;
  const c = await db.query<{ id: string }>('SELECT id FROM circles WHERE slug = $1 AND hidden_at IS NULL', [slug]);
  const id = c.rows[0]?.id;
  if (!id || !(await myRole(db, id, accountId))) return null;
  return interestsOf(db, id);
}
