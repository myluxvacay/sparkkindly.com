// Circle scores (plan 4C, spec Project 4 "Competitions" and "Leaderboards"). Derived on every read from item_responses
// joined to the circle's daily sets, so a deletion or a re-scored answer recomputes by itself. A member earns
// points_correct (site_settings, default 10) per set item answered correctly inside that circle day (circles.time_zone);
// nothing for speed. Set items are re-filtered with the circle's current audiences (PLAYABLE) and its child days
// (CHILD_DAY_SAFE), so an `adults` item scores
// nothing while a child is in the circle. Former members (left_at) keep their points as "Former member". Competition
// ranks: ties share, the next rank skips. Members only (circleForViewer); never which answer anyone chose.
// Imported only under app/circles/** and lib/circles/** (tests/unit/circles-play-web.test.ts scans for it).
// No Next.js imports. Verified by tests/unit/circles-scores.test.ts.
import type { Db } from '@/lib/db';
import { CHILD_DAY_SAFE, PLAYABLE, circleAudiences, circleDay, circleForViewer } from './daily-set';
import { pointsCorrect } from './points';

export type BoardRow = { rank: number; name: string; points: number; former: boolean; you: boolean };
export type Board = BoardRow[];
export type Tallies = {
  day: Board;
  week: Board;
  month: Board;
  allTime: Board;
  circleTotals: { day: number; week: number; month: number; allTime: number };
};
type Period = 'day' | 'week' | 'month' | 'allTime';
const PERIODS: Period[] = ['day', 'week', 'month', 'allTime'];

// Rank = 1 + how many score strictly more, for any order of `points`.
export function rankWithTies(points: number[]): number[] {
  return points.map((p) => 1 + points.filter((q) => q > p).length);
}

type Row = { name: string; former: boolean; you: boolean } & Record<Period, number>;

// One aggregate over every member row (current and former) with correct counts per window. $1 clock, $2 audiences.
// Also read by the weekly email (lib/circles/mail.ts), which uses aid and pid to find the recipient's own rows.
export const COUNTS = `
  WITH scored AS (
    SELECT r.account_id, r.profile_id, s.day
    FROM circle_daily_sets s
    JOIN items i ON i.id = s.item_id JOIN worlds w ON w.id = i.world_id
    JOIN item_responses r ON r.item_id = s.item_id AND r.correct
    WHERE s.circle_id = $3 AND s.day <= $5::date AND (r.answered_at AT TIME ZONE $4::text)::date = s.day AND ${PLAYABLE}
      AND ${CHILD_DAY_SAFE}
  )
  SELECT m.display_name AS name, m.left_at IS NOT NULL AS former, m.account_id AS aid, m.profile_id AS pid,
         (m.account_id = $6 AND m.profile_id IS NOT DISTINCT FROM $7::uuid) AS you,
         (count(x.day) FILTER (WHERE x.day = $5::date))::int AS day,
         (count(x.day) FILTER (WHERE x.day >= date_trunc('week', $5::date)::date))::int AS week,
         (count(x.day) FILTER (WHERE x.day >= date_trunc('month', $5::date)::date))::int AS month,
         count(x.day)::int AS "allTime"
  FROM circle_members m
  LEFT JOIN scored x ON x.account_id = m.account_id AND x.profile_id IS NOT DISTINCT FROM m.profile_id
  WHERE m.circle_id = $3
  GROUP BY m.account_id, m.profile_id, m.display_name, m.left_at, m.joined_at
  ORDER BY m.joined_at, m.account_id, m.profile_id NULLS FIRST`;

function board(rows: Row[], period: Period, points: number): Board {
  // A former member appears only in the windows where they scored.
  const list = rows
    .filter((r) => !r.former || r[period] > 0)
    .map((r) => ({ name: r.former ? 'Former member' : r.name, points: r[period] * points, former: r.former, you: r.you }));
  // Stable sort: equal points keep join order, current members before former ones.
  list.sort((a, b) => b.points - a.points || Number(a.former) - Number(b.former));
  const ranks = rankWithTies(list.map((x) => x.points));
  return list.map((x, i) => ({ rank: ranks[i], ...x }));
}

const total = (b: Board) => b.reduce((sum, r) => sum + r.points, 0);

export async function getTallies(
  db: Db,
  accountId: string,
  profileId: string | null,
  slug: string,
  now: Date,
): Promise<Tallies | null> {
  const c = await circleForViewer(db, accountId, profileId, slug);
  if (!c) return null;
  const audiences = await circleAudiences(db, c.id);
  const today = circleDay(c.timeZone, now);
  const r = await db.query<Row>(COUNTS, [now, [...audiences], c.id, c.timeZone, today, accountId, profileId]);
  const points = await pointsCorrect(db);
  const [day, week, month, allTime] = PERIODS.map((p) => board(r.rows, p, points));
  return { day, week, month, allTime, circleTotals: { day: total(day), week: total(week), month: total(month), allTime: total(allTime) } };
}
