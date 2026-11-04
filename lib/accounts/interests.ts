// Interests: the topics and worlds a profile (the account holder's own, or one child profile) cares about. References
// existing topics and enabled worlds by integer id; at most 30 in total; a save replaces the whole set in one
// transaction. The owner comes from the server-side context; a profile id that is not the account's is refused.
// No Next.js imports.
// Verified by tests/unit/account-interests.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { isUuid } from './pin';

export type Owner = { accountId: string; profileId: string | null };
export type Interests = { topicIds: number[]; worldIds: number[] };

export const MAX_INTERESTS = 30;

const NIL = '00000000-0000-0000-0000-000000000000';
// Matches a profile's rows; NULL (the account holder) compares equal to NULL through the zero uuid.
export const SAME_OWNER = `account_id = $1 AND COALESCE(profile_id, '${NIL}'::uuid) = COALESCE($2::uuid, '${NIL}'::uuid)`;

// A profile id counts only when it is a well-formed uuid; null is the account holder.
export const validOwner = (o: Owner): boolean => isUuid(o.accountId) && (o.profileId === null || isUuid(o.profileId));

// Positive integers, no duplicates; null when anything else.
function cleanIds(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length > MAX_INTERESTS) {
    return null;
  }
  if (!v.every((x) => Number.isSafeInteger(x) && x > 0 && x <= 2_147_483_647)) {
    return null;
  }
  return new Set(v).size === v.length ? (v as number[]) : null;
}

// Whether the profile is this account's (the holder needs no check). The composite foreign key enforces the same.
async function ownsProfile(tx: Queryable, o: Owner): Promise<boolean> {
  if (o.profileId === null) {
    return true;
  }
  const r = await tx.query('SELECT 1 FROM child_profiles WHERE id = $1 AND account_id = $2', [
    o.profileId,
    o.accountId,
  ]);
  return r.rows.length > 0;
}

export async function setInterests(
  db: Db,
  owner: Owner,
  input: { topicIds: unknown; worldIds: unknown },
): Promise<'ok' | 'invalid'> {
  const topicIds = cleanIds(input.topicIds);
  const worldIds = cleanIds(input.worldIds);
  if (!validOwner(owner) || !topicIds || !worldIds || topicIds.length + worldIds.length > MAX_INTERESTS) {
    return 'invalid';
  }
  return db.transaction(async (tx) => {
    // Serialise saves for one account (two tabs saving at once) so the delete-then-insert cannot collide.
    await tx.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', [owner.accountId]);
    if (!(await ownsProfile(tx, owner))) {
      return 'invalid';
    }
    const t = await tx.query('SELECT id FROM topics WHERE id = ANY($1::int[])', [topicIds]);
    const w = await tx.query('SELECT id FROM worlds WHERE enabled AND id = ANY($1::int[])', [worldIds]);
    if (t.rows.length !== topicIds.length || w.rows.length !== worldIds.length) {
      return 'invalid';
    }
    await tx.query(`DELETE FROM profile_interests WHERE ${SAME_OWNER}`, [owner.accountId, owner.profileId]);
    await tx.query(
      'INSERT INTO profile_interests (account_id, profile_id, topic_id) SELECT $1, $2, x FROM unnest($3::int[]) AS x',
      [owner.accountId, owner.profileId, topicIds],
    );
    await tx.query(
      'INSERT INTO profile_interests (account_id, profile_id, world_id) SELECT $1, $2, x FROM unnest($3::int[]) AS x',
      [owner.accountId, owner.profileId, worldIds],
    );
    return 'ok';
  });
}

export type Choice = { id: number; name: string };
export type TopicGroup = { name: string; topics: Choice[] };

// What the interests page offers: enabled worlds, and topics grouped under their parent (a parent comes first in its
// own group; a top-level topic with no children is grouped under "Other").
export async function interestChoices(db: Queryable): Promise<{ worlds: Choice[]; topicGroups: TopicGroup[] }> {
  const w = await db.query<Choice>('SELECT id, name FROM worlds WHERE enabled ORDER BY sort, slug');
  const t = await db.query<Choice & { parent_id: number | null }>('SELECT id, name, parent_id FROM topics ORDER BY name');
  const parents = new Set(t.rows.flatMap((x) => (x.parent_id === null ? [] : [x.parent_id])));
  const groups = new Map<number | 'other', TopicGroup>();
  for (const x of t.rows.filter((r) => r.parent_id === null)) {
    if (parents.has(x.id)) groups.set(x.id, { name: x.name, topics: [{ id: x.id, name: `${x.name} in general` }] });
  }
  const other: TopicGroup = { name: 'Other', topics: [] };
  for (const x of t.rows) {
    if (x.parent_id !== null) (groups.get(x.parent_id) ?? other).topics.push({ id: x.id, name: x.name });
    else if (!parents.has(x.id)) other.topics.push({ id: x.id, name: x.name });
  }
  const topicGroups = [...groups.values()];
  return { worlds: w.rows, topicGroups: other.topics.length ? [...topicGroups, other] : topicGroups };
}

export async function getInterests(db: Db, owner: Owner): Promise<Interests> {
  if (!validOwner(owner)) {
    return { topicIds: [], worldIds: [] };
  }
  const r = await db.query<{
    topic_id: number | null;
    world_id: number | null;
  }>(`SELECT topic_id, world_id FROM profile_interests WHERE ${SAME_OWNER} ORDER BY topic_id, world_id`, [
    owner.accountId,
    owner.profileId,
  ]);
  return {
    topicIds: r.rows.flatMap((x) => (x.topic_id === null ? [] : [x.topic_id])),
    worldIds: r.rows.flatMap((x) => (x.world_id === null ? [] : [x.world_id])),
  };
}
