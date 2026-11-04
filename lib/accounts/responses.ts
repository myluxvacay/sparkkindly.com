// Saved answers: a profile's FIRST answer to each playable item, with correctness and server time. A repeat answer is
// ignored, so correctness never changes. The owner comes from the server-side context; a profile id that is not the
// account's is refused (composite foreign key plus a code check). No Next.js imports. Verified by
// tests/unit/account-responses.test.ts.
import type { Db } from '@/lib/db';
import { isUuid } from './pin';
import { SAME_OWNER, validOwner, type Owner } from './interests';

export type Answered = { itemId: string; correct: boolean; answeredAt: Date };

// True when this answer was newly stored; false when ignored (repeat, unknown item, foreign profile, bad id).
export async function recordAnswer(
  db: Db,
  owner: Owner,
  itemId: string,
  correct: boolean,
  now: Date,
): Promise<boolean> {
  if (!validOwner(owner) || !isUuid(itemId)) {
    return false;
  }
  try {
    const r = await db.query(
      `INSERT INTO item_responses (account_id, profile_id, item_id, correct, answered_at)
       SELECT $1, $2, $3, $4, $5
       WHERE EXISTS (SELECT 1 FROM items WHERE id = $3)
         AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM child_profiles WHERE id = $2 AND account_id = $1))
       ON CONFLICT DO NOTHING`,
      [owner.accountId, owner.profileId, itemId, correct, now.toISOString()],
    );
    return (r.rowCount ?? 0) > 0;
  } catch {
    return false; // e.g. the account was deleted between the session check and this write
  }
}

export async function listAnswered(db: Db, owner: Owner, page: { limit: number; offset: number }): Promise<Answered[]> {
  if (!validOwner(owner)) {
    return [];
  }
  const r = await db.query<{
    item_id: string;
    correct: boolean;
    answered_at: Date;
  }>(
    `SELECT item_id, correct, answered_at FROM item_responses WHERE ${SAME_OWNER}
     ORDER BY answered_at DESC, item_id LIMIT $3 OFFSET $4`,
    [owner.accountId, owner.profileId, page.limit, page.offset],
  );
  return r.rows.map((x) => ({
    itemId: x.item_id,
    correct: x.correct,
    answeredAt: x.answered_at,
  }));
}

export async function countAnswered(db: Db, owner: Owner): Promise<{ total: number; correct: number }> {
  if (!validOwner(owner)) {
    return { total: 0, correct: 0 };
  }
  const r = await db.query<{ total: number; correct: number }>(
    `SELECT count(*)::int AS total, (count(*) FILTER (WHERE correct))::int AS correct
     FROM item_responses WHERE ${SAME_OWNER}`,
    [owner.accountId, owner.profileId],
  );
  return { total: r.rows[0].total, correct: r.rows[0].correct };
}
