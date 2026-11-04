// Saved answers: a profile's FIRST answer to each playable item, with correctness and server time. A repeat answer is
// ignored, so correctness never changes. The owner comes from the server-side context; a profile id that is not the
// account's is refused (composite foreign key plus a code check). No Next.js imports. Verified by
// tests/unit/account-responses.test.ts.
import type { Db } from '@/lib/db';
import { isUuid } from './pin';
import type { Audience } from '@/lib/public/scope';
import { SAME_OWNER, validOwner, type Owner } from './interests';

const OWNER = (a: string) => SAME_OWNER.replaceAll(/(account_id|profile_id)/g, `${a}.$1`);

const FK_VIOLATION = '23503';
const whole = (n: number, fallback: number) => (Number.isFinite(n) ? Math.floor(n) : fallback);

// Answered items are shown only while the item is still published, in an enabled world and in an allowed audience.
const SHOWN = `i.status = 'published' AND w.enabled AND i.audience = ANY($3::text[])`;
const FROM_SHOWN = `FROM item_responses r JOIN items i ON i.id = r.item_id JOIN worlds w ON w.id = i.world_id`;

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
  } catch (e) {
    // Only a foreign-key violation (the account or profile was deleted between the session check and this write) is a
    // plain "not stored"; anything else is a real fault the caller should log.
    if ((e as { code?: string }).code === FK_VIOLATION) {
      return false;
    }
    throw e;
  }
}

export async function listAnswered(
  db: Db,
  owner: Owner,
  audiences: readonly Audience[],
  page: { limit: number; offset: number },
): Promise<Answered[]> {
  if (!validOwner(owner) || audiences.length === 0) {
    return [];
  }
  const limit = Math.min(100, Math.max(1, whole(page.limit, 20)));
  const offset = Math.max(0, whole(page.offset, 0));
  const r = await db.query<{ item_id: string; correct: boolean; answered_at: Date }>(
    `SELECT r.item_id, r.correct, r.answered_at ${FROM_SHOWN}
     WHERE ${OWNER('r')} AND ${SHOWN}
     ORDER BY r.answered_at DESC, r.item_id LIMIT $4 OFFSET $5`,
    [owner.accountId, owner.profileId, [...audiences], limit, offset],
  );
  return r.rows.map((x) => ({ itemId: x.item_id, correct: x.correct, answeredAt: x.answered_at }));
}

export async function countAnswered(
  db: Db,
  owner: Owner,
  audiences: readonly Audience[],
): Promise<{ total: number; correct: number }> {
  if (!validOwner(owner) || audiences.length === 0) {
    return { total: 0, correct: 0 };
  }
  const r = await db.query<{ total: number; correct: number }>(
    `SELECT count(*)::int AS total, (count(*) FILTER (WHERE r.correct))::int AS correct ${FROM_SHOWN}
     WHERE ${OWNER('r')} AND ${SHOWN}`,
    [owner.accountId, owner.profileId, [...audiences]],
  );
  return { total: r.rows[0].total, correct: r.rows[0].correct };
}
