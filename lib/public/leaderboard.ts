// The public leaderboard (Project 4.11, ADR 0004): opted-in account holders aged 16+ ranked by the points their
// own saved answers earned. Points are the holder's correct answers at the same points_correct value circles use
// (lib/circles/points.ts, kept apart from the circle scoreboards for reuse). Only the holder's own responses
// count (profile_id IS NULL, so a child profile's answers can never appear), and Kids-world items are excluded.
// Eligibility is re-derived on every read from the stored date of birth through the account policy, so an
// account that was never eligible cannot appear even if its opt-in flag was set by hand. Ranks are competition
// ranks: ties share, the next rank skips. Imported only by the /leaderboard page.
// Verified by tests/unit/public-leaderboard.test.ts.
import type { Db } from '@/lib/db';
import { ageGroupFor, can, type Consent } from '@/lib/accounts/policy';
import { pointsCorrect } from '@/lib/circles/points';

export type PublicBoardRow = {
  rank: number;
  name: string;
  avatarKey: string | null;
  points: number;
  correct: number;
  you: boolean;
};
export type PublicBoards = { month: PublicBoardRow[]; allTime: PublicBoardRow[] };

export const BOARD_LIMIT = 50;

// Rank = 1 + how many score strictly more, for any order of `points` (same rule as the circle boards).
export function rankWithTies(points: number[]): number[] {
  return points.map((p) => 1 + points.filter((q) => q > p).length);
}

type Row = {
  id: string;
  name: string;
  avatar: string | null;
  dob: string;
  consent: Consent;
  month: number;
  allTime: number;
};

export async function getPublicBoards(db: Db, now: Date, viewerAccountId?: string | null): Promise<PublicBoards> {
  const per = await pointsCorrect(db);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const r = await db.query<Row>(
    `SELECT a.id, a.public_name AS name, a.avatar_key AS avatar, a.date_of_birth::text AS dob,
            a.consent_state AS consent,
            (count(*) FILTER (WHERE r.answered_at >= $1::timestamptz))::int AS month,
            (count(*))::int AS "allTime"
     FROM accounts a
     JOIN item_responses r ON r.account_id = a.id AND r.profile_id IS NULL AND r.correct
     JOIN items i ON i.id = r.item_id
     JOIN worlds w ON w.id = i.world_id AND w.slug <> 'kids'
     WHERE a.leaderboard_opt_in AND a.public_name IS NOT NULL
     GROUP BY a.id`,
    [monthStart],
  );
  const eligible = r.rows.filter((row) => {
    const group = ageGroupFor(String(row.dob), now);
    return group !== null && can(group, row.consent, 'public_leaderboard');
  });
  const board = (pick: (row: Row) => number): PublicBoardRow[] => {
    const scored = eligible
      .filter((row) => pick(row) > 0)
      .sort((a, b) => pick(b) - pick(a) || a.name.localeCompare(b.name));
    const ranks = rankWithTies(scored.map(pick));
    return scored.slice(0, BOARD_LIMIT).map((row, i) => ({
      rank: ranks[i],
      name: row.name,
      avatarKey: row.avatar,
      points: pick(row) * per,
      correct: pick(row),
      you: viewerAccountId != null && row.id === viewerAccountId,
    }));
  };
  return { month: board((row) => row.month), allTime: board((row) => row.allTime) };
}
