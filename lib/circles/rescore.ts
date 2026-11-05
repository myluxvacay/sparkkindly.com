// Re-scoring (plan 4C, spec Project 4 "Circle rules": a corrected quiz answer re-scores affected answers and the circle
// is notified). changeAnswerKey is the one way to change item_answers.answer for an existing item: it rescoreItem()s in
// the caller's transaction. Only rows that kept their choice (item_responses.choice) are re-checked; older rows are not
// re-scorable and stay as they are. A circle gets one circle_notices row (shown on the circle page; emailed in 4D) only
// when a flipped answer counted in its scores: given by a current or former member (account or child profile) on one of
// its set days of the last 30 days that has the item, with the item visible to that circle (PLAYABLE, CHILD_DAY_SAFE),
// as lib/circles/scores.ts counts it (final review 4). No Next.js imports.
// Verified by tests/unit/circles-rescore.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { mechanics, type Mechanic } from '@/lib/items/format';
import { checkAnswer } from '@/lib/play/check';
import { isUuid } from '@/lib/accounts/pin';
import { CHILD_DAY_SAFE, PLAYABLE, circleAudiences } from './daily-set';
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
  const flipped: string[] = [];
  // ponytail: one UPDATE per flipped row; fine for the answers one item gets, batch it if items reach thousands.
  for (const r of rows.rows) {
    const correct = checkAnswer(key.mechanic as Mechanic, key.answer, r.choice);
    if (correct === r.correct) continue;
    await tx.query(
      'UPDATE item_responses SET correct = $4 WHERE item_id = $1 AND account_id = $2 AND profile_id IS NOT DISTINCT FROM $3::uuid',
      [itemId, r.account_id, r.profile_id, correct],
    );
    flipped.push(ownerKey(r.account_id, r.profile_id));
  }
  return { changed: flipped.length, circles: flipped.length > 0 ? await notify(tx, itemId, flipped, now) : 0 };
}

const ownerKey = (accountId: string, profileId: string | null) => `${accountId}:${profileId ?? ''}`;

// Circles that had the item in a set in the last NOTICE_DAYS days: the candidates for a notice.
async function recentCircles(tx: Queryable, itemId: string, now: Date): Promise<string[]> {
  const r = await tx.query<{ id: string }>(
    `SELECT DISTINCT circle_id AS id FROM circle_daily_sets
     WHERE item_id = $1 AND day >= ($2::timestamptz - make_interval(days => ${NOTICE_DAYS}))::date`,
    [itemId, now.toISOString()],
  );
  return r.rows.map((x) => x.id);
}

// Whether one of the flipped answers counted for this circle (the scores.ts join, limited to the flipped owners).
async function countedIn(tx: Queryable, circleId: string, itemId: string, flipped: string[], now: Date): Promise<boolean> {
  const r = await tx.query(
    `SELECT 1 FROM circle_daily_sets s JOIN circles c ON c.id = s.circle_id
       JOIN items i ON i.id = s.item_id JOIN worlds w ON w.id = i.world_id
       JOIN item_responses r ON r.item_id = s.item_id
       JOIN circle_members m ON m.circle_id = s.circle_id AND m.account_id = r.account_id
         AND m.profile_id IS NOT DISTINCT FROM r.profile_id
     WHERE s.circle_id = $3 AND s.item_id = $4
       AND s.day >= ($1::timestamptz - make_interval(days => ${NOTICE_DAYS}))::date
       AND (r.answered_at AT TIME ZONE c.time_zone)::date = s.day
       AND (r.account_id::text || ':' || COALESCE(r.profile_id::text, '')) = ANY($5::text[])
       AND ${PLAYABLE} AND ${CHILD_DAY_SAFE}
     LIMIT 1`,
    [now, [...(await circleAudiences(tx, circleId))], circleId, itemId, flipped],
  );
  return r.rows.length > 0;
}

async function notify(tx: Queryable, itemId: string, flipped: string[], now: Date): Promise<number> {
  let n = 0;
  for (const circleId of await recentCircles(tx, itemId, now)) {
    if (!(await countedIn(tx, circleId, itemId, flipped, now))) continue;
    await tx.query(
      "INSERT INTO circle_notices (circle_id, item_id, kind, created_at) VALUES ($1, $2, 'rescored', $3::timestamptz)",
      [circleId, itemId, now.toISOString()],
    );
    n++;
  }
  return n;
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
