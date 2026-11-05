// Re-scoring (plan 4C, spec Project 4 "Circle rules": a corrected quiz answer re-scores affected answers and the circle
// is notified). changeAnswerKey is the one way to change item_answers.answer for an existing item: it rescoreItem()s in
// the caller's transaction. Only rows that kept their choice (item_responses.choice) are re-checked; older rows are not
// re-scorable and stay as they are. When anything flips, each circle that had the item in a set in the last 30 days
// gets one circle_notices row (shown on the circle page; emailed in 4D). No Next.js imports.
// Verified by tests/unit/circles-rescore.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { mechanics, type Mechanic } from '@/lib/items/format';
import { checkAnswer } from '@/lib/play/check';
import { isUuid } from '@/lib/accounts/pin';
import { isSlug, myRole } from './repo';

export const NOTICE_DAYS = 30;
export type RescoreResult = { changed: number; circles: number };

type Stored = { account_id: string; profile_id: string | null; correct: boolean; choice: unknown };

export async function rescoreItem(tx: Queryable, itemId: string, now: Date): Promise<RescoreResult> {
  const k = await tx.query<{ mechanic: unknown; answer: unknown }>(
    `SELECT i.body->>'mechanic' AS mechanic, a.answer FROM items i JOIN item_answers a ON a.item_id = i.id WHERE i.id = $1`,
    [itemId],
  );
  const key = k.rows[0];
  if (!key || !mechanics.includes(key.mechanic as Mechanic)) return { changed: 0, circles: 0 };
  const rows = await tx.query<Stored>(
    'SELECT account_id, profile_id, correct, choice FROM item_responses WHERE item_id = $1 AND choice IS NOT NULL FOR UPDATE',
    [itemId],
  );
  let changed = 0;
  // ponytail: one UPDATE per flipped row; fine for the answers one item gets, batch it if items reach thousands.
  for (const r of rows.rows) {
    const correct = checkAnswer(key.mechanic as Mechanic, key.answer, r.choice);
    if (correct === r.correct) continue;
    await tx.query(
      'UPDATE item_responses SET correct = $4 WHERE item_id = $1 AND account_id = $2 AND profile_id IS NOT DISTINCT FROM $3::uuid',
      [itemId, r.account_id, r.profile_id, correct],
    );
    changed++;
  }
  return { changed, circles: changed > 0 ? await notify(tx, itemId, now) : 0 };
}

async function notify(tx: Queryable, itemId: string, now: Date): Promise<number> {
  const r = await tx.query(
    `INSERT INTO circle_notices (circle_id, item_id, kind, created_at)
     SELECT DISTINCT circle_id, $1::uuid, 'rescored', $2::timestamptz FROM circle_daily_sets
     WHERE item_id = $1 AND day >= ($2::timestamptz - make_interval(days => ${NOTICE_DAYS}))::date`,
    [itemId, now.toISOString()],
  );
  return r.rowCount ?? 0;
}

// Null when the item has no answer row.
export async function changeAnswerKey(tx: Queryable, itemId: string, answer: unknown, now: Date): Promise<RescoreResult | null> {
  const r = await tx.query('UPDATE item_answers SET answer = $2::jsonb WHERE item_id = $1', [itemId, JSON.stringify(answer)]);
  return (r.rowCount ?? 0) > 0 ? rescoreItem(tx, itemId, now) : null;
}

// The circle's notices of the last 30 days, newest first, for a current account member; null for anyone else. Only the
// time: no item, no answer.
export async function listNotices(db: Db, accountId: string, slug: string, now: Date): Promise<{ at: Date }[] | null> {
  if (!isUuid(accountId) || !isSlug(slug)) return null;
  const c = await db.query<{ id: string }>('SELECT id FROM circles WHERE slug = $1 AND hidden_at IS NULL', [slug]);
  const id = c.rows[0]?.id;
  if (!id || !(await myRole(db, id, accountId))) return null;
  const r = await db.query<{ at: Date }>(
    `SELECT created_at AS at FROM circle_notices
     WHERE circle_id = $1 AND created_at >= $2::timestamptz - make_interval(days => ${NOTICE_DAYS})
     ORDER BY created_at DESC, id DESC LIMIT 10`,
    [id, now.toISOString()],
  );
  return r.rows;
}
