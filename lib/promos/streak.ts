// The streak engine for the `streak_draw` promo type. A streak is DERIVED, never stored: it is computed from the
// answers already saved in item_responses (lib/accounts/responses.ts) against each day's designated Question of
// the Day, so there is no second tracking store to disagree with the play history.
//
// The designated question for a site-day is the quiz the site itself shows that day: the most recently published
// quiz (the same pick latestQuiz makes for the home page and /quiz/, in the same order — published_at desc, id
// asc), carried forward until a newer one publishes. Quiz publication is date-based (a quiz's published_at is
// its scheduled day at 00:00 UTC), so site-days here are UTC dates. Only quizzes every account kind can see
// (audiences kids/all, enabled world, en) can be designated: an `adults`-audience quiz is never the daily
// question for streak purposes, because a child profile could not answer it.
//
// A day counts when the owner's FIRST saved answer to that day's designated question, given on that day, is
// correct (item_responses holds first answers only, so a wrong first answer can never be repaired — the same
// rule the rest of the site plays by). No Next.js imports. Verified by tests/unit/promos-streak.test.ts.
import type { Queryable } from '@/lib/db';
import { SAME_OWNER, validOwner, type Owner } from '@/lib/accounts/interests';
import type { StreakConfig } from './types';

export const DAY_MS = 86_400_000;

// YYYY-MM-DD (UTC) for a Date.
export const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);
const addDays = (day: string, n: number) => dayOf(new Date(dayStart(day) + n * DAY_MS));

export type StreakState = {
  // Length of the run still alive today (0 when no run is live).
  current: number;
  // Longest run ever, completed or not.
  best: number;
  // Freezes left in the live run (the full allowance when no run is live).
  freezeLeft: number;
  // True when today's designated question is already answered correctly.
  todayDone: boolean;
  // Every date on which a run reached the target, ascending. A date in a month makes that month's draw pool.
  completedOn: string[];
};

const ZERO: StreakState = { current: 0, best: 0, freezeLeft: 0, todayDone: false, completedOn: [] };

// The pure walk. `questionDays` is every site-day (ascending, ending today) that has a designated question;
// `answered` is the subset of those days the owner answered correctly on the day. A missed past day inside a
// live run spends a freeze and still counts toward the run (the forgiven day is a streak day); a missed day
// with no freeze left ends the run. Today is never a miss: the day is still open, so it neither breaks a run
// nor spends a freeze. Reaching the target records a completion on that day and closes the attempt — the next
// day starts a fresh run with a fresh freeze.
export function computeStreak(
  answered: ReadonlySet<string>,
  questionDays: readonly string[],
  today: string,
  cfg: StreakConfig,
): StreakState {
  let run = 0;
  let freezes = 0;
  let best = 0;
  const completedOn: string[] = [];
  for (const day of questionDays) {
    if (answered.has(day)) {
      run++;
    } else if (day === today) {
      // The day is still open: nothing breaks, nothing is spent.
    } else if (run > 0 && freezes < cfg.freezeAllowance) {
      run++;
      freezes++;
    } else if (run > 0) {
      run = 0;
      freezes = 0;
    }
    if (run > best) best = run;
    if (run >= cfg.targetDays) {
      completedOn.push(day);
      run = 0;
      freezes = 0;
    }
  }
  return {
    current: run,
    best,
    freezeLeft: cfg.freezeAllowance - freezes,
    todayDone: answered.has(today),
    completedOn,
  };
}

type QuizRow = { id: string; published_at: Date };

// The designated Question of the Day for each site-day from the first published quiz to today, as a map of
// day -> item id, plus the ascending list of days. Mirrors latestQuiz's pick (published_at desc, id asc) at
// each day's close, restricted to quizzes every account kind may see.
export function designate(
  quizzes: readonly QuizRow[],
  today: string,
): { days: string[]; byDay: Map<string, string> } {
  const byDay = new Map<string, string>();
  if (quizzes.length === 0) return { days: [], byDay };
  const sorted = [...quizzes].sort(
    (a, b) => b.published_at.getTime() - a.published_at.getTime() || (a.id < b.id ? -1 : 1),
  );
  const firstDay = dayOf(sorted[sorted.length - 1].published_at);
  const days: string[] = [];
  for (let d = firstDay; d <= today; d = addDays(d, 1)) {
    const end = dayStart(d) + DAY_MS;
    const q = sorted.find((x) => x.published_at.getTime() < end);
    if (q) {
      byDay.set(d, q.id);
      days.push(d);
    }
  }
  return { days, byDay };
}

async function publishedQuizzes(db: Queryable, now: Date): Promise<QuizRow[]> {
  const r = await db.query<QuizRow>(
    `SELECT i.id, i.published_at FROM items i JOIN worlds w ON w.id = i.world_id
     WHERE i.kind = 'quiz' AND i.status = 'published' AND i.published_at IS NOT NULL AND i.published_at <= $1
       AND w.enabled AND i.locale = 'en' AND i.audience IN ('kids', 'all')`,
    [now],
  );
  return r.rows;
}

// The owner's streak right now, plus today's designated question id (null before the first quiz ever).
export async function streakForOwner(
  db: Queryable,
  owner: Owner,
  now: Date,
  cfg: StreakConfig,
): Promise<StreakState & { todayQuestionId: string | null }> {
  if (!validOwner(owner)) return { ...ZERO, freezeLeft: cfg.freezeAllowance, todayQuestionId: null };
  const today = dayOf(now);
  const { days, byDay } = designate(await publishedQuizzes(db, now), today);
  if (days.length === 0) return { ...ZERO, freezeLeft: cfg.freezeAllowance, todayQuestionId: null };
  const r = await db.query<{ item_id: string; day: string }>(
    `SELECT r.item_id, (r.answered_at AT TIME ZONE 'UTC')::date::text AS day
     FROM item_responses r WHERE ${SAME_OWNER.replaceAll(/\b(account_id|profile_id)\b/g, 'r.$1')} AND r.correct`,
    [owner.accountId, owner.profileId],
  );
  const answered = new Set<string>();
  for (const row of r.rows) {
    if (byDay.get(row.day) === row.item_id) answered.add(row.day);
  }
  return { ...computeStreak(answered, days, today, cfg), todayQuestionId: byDay.get(today) ?? null };
}

// The months (YYYY-MM) in which this owner has completed at least one streak.
export const completedMonths = (s: StreakState): string[] => [...new Set(s.completedOn.map((d) => d.slice(0, 7)))];
