// The streak engine for the `streak_draw` promo type. A streak is DERIVED, never stored: it is computed from the
// answers already saved in item_responses (lib/accounts/responses.ts) against the designated Question of the
// Day, so there is no second tracking store to disagree with the play history.
//
// Site-days are the site's own content days, not UTC calendar days: new content publishes at the 06:00 UTC slot
// (SLOT_HOUR_UTC in lib/items/policy.ts), so a site-day runs 06:00 UTC to the next 06:00 UTC, keyed by the UTC
// date of its start. The designated question at any moment is the quiz the site itself is showing then — the
// most recently published quiz (the same pick latestQuiz makes for the home page and /quiz/, in the same
// order: published_at desc, id asc), as visible to the ANSWERER: a child profile's audiences are kids/all (an
// `adults`-audience quiz is never their daily question, because they cannot see it), while an account holder
// sees every audience, exactly as their /quiz/ page does. An answer counts toward the site-day it was given in
// when its item was the designated question at that moment.
//
// A day counts on a correct FIRST saved answer (item_responses holds first answers only, so a wrong first
// answer can never be repaired — the same rule the rest of the site plays by). No Next.js imports.
// Verified by tests/unit/promos-streak.test.ts.
import type { Queryable } from '@/lib/db';
import { CHILD_AUDIENCES } from '@/lib/accounts/context';
import { SAME_OWNER, validOwner, type Owner } from '@/lib/accounts/interests';
import type { Audience } from '@/lib/items/repo';
import type { StreakConfig } from './types';

export const DAY_MS = 86_400_000;

// The hour (UTC) a site-day starts: the content publish slot, mirrored from SLOT_HOUR_UTC in
// lib/items/policy.ts. If that slot ever moves, this must move with it.
export const SITE_DAY_START_HOUR_UTC = 6;

// YYYY-MM-DD (UTC) for a Date.
export const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);
const addDays = (day: string, n: number) => dayOf(new Date(dayStart(day) + n * DAY_MS));

// The site-day (YYYY-MM-DD) a moment falls in: the window starting at 06:00 UTC, keyed by its start date.
export const siteDayOf = (d: Date): string => dayOf(new Date(d.getTime() - SITE_DAY_START_HOUR_UTC * 3_600_000));

export type StreakState = {
  // Length of the run still alive today (0 when no run is live).
  current: number;
  // Longest run ever, completed or not.
  best: number;
  // Freezes left in the live run (the full allowance when no run is live).
  freezeLeft: number;
  // True when today's designated question is already answered correctly.
  todayDone: boolean;
  // Every site-day on which a run reached the target, ascending. A date in a month makes that month's draw pool.
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

// Quizzes in designation order: the site's own pick order (published_at desc, id asc — the ORDER BY in
// lib/public/reads.ts listPublic).
export const byDesignation = (quizzes: readonly QuizRow[]): QuizRow[] =>
  [...quizzes].sort((a, b) => b.published_at.getTime() - a.published_at.getTime() || (a.id < b.id ? -1 : 1));

// The designated Question of the Day at a moment: the most recently published quiz at or before it, carried
// forward until a newer one publishes. Null before the first quiz ever.
export function designatedAt(sortedQuizzes: readonly QuizRow[], at: Date): QuizRow | null {
  return sortedQuizzes.find((q) => q.published_at.getTime() <= at.getTime()) ?? null;
}

// The audiences whose quizzes can be designated for this owner — the same audiences the owner's own pages
// read with (lib/accounts/context.ts): a child profile sees kids/all only; a holder sees every audience.
const audiencesFor = (owner: Owner): readonly Audience[] =>
  owner.profileId ? CHILD_AUDIENCES : ['kids', 'all', 'adults'];

async function publishedQuizzes(db: Queryable, now: Date, audiences: readonly Audience[]): Promise<QuizRow[]> {
  const r = await db.query<QuizRow>(
    `SELECT i.id, i.published_at FROM items i JOIN worlds w ON w.id = i.world_id
     WHERE i.kind = 'quiz' AND i.status = 'published' AND i.published_at IS NOT NULL AND i.published_at <= $1
       AND w.enabled AND i.locale = 'en' AND i.audience = ANY($2::text[])`,
    [now, [...audiences]],
  );
  return r.rows;
}

// The owner's streak right now, plus the question currently designated for them (null before the first quiz
// ever). `sinceDay` bounds the count to site-days on or after it (a promotion's start: days before a promo
// existed never count toward it).
export async function streakForOwner(
  db: Queryable,
  owner: Owner,
  now: Date,
  cfg: StreakConfig,
  opts: { sinceDay?: string | null } = {},
): Promise<StreakState & { todayQuestionId: string | null }> {
  if (!validOwner(owner)) return { ...ZERO, freezeLeft: cfg.freezeAllowance, todayQuestionId: null };
  const quizzes = byDesignation(await publishedQuizzes(db, now, audiencesFor(owner)));
  if (quizzes.length === 0) return { ...ZERO, freezeLeft: cfg.freezeAllowance, todayQuestionId: null };
  const today = siteDayOf(now);
  const firstDay = siteDayOf(quizzes[quizzes.length - 1].published_at);
  const days: string[] = [];
  for (let d = firstDay; d <= today; d = addDays(d, 1)) {
    if (!opts.sinceDay || d >= opts.sinceDay) days.push(d);
  }
  if (days.length === 0) return { ...ZERO, freezeLeft: cfg.freezeAllowance, todayQuestionId: designatedAt(quizzes, now)?.id ?? null };
  const r = await db.query<{ item_id: string; answered_at: Date }>(
    `SELECT r.item_id, r.answered_at FROM item_responses r
     WHERE ${SAME_OWNER.replaceAll(/\b(account_id|profile_id)\b/g, 'r.$1')} AND r.correct`,
    [owner.accountId, owner.profileId],
  );
  const answered = new Set<string>();
  for (const row of r.rows) {
    if (designatedAt(quizzes, row.answered_at)?.id === row.item_id) answered.add(siteDayOf(row.answered_at));
  }
  return { ...computeStreak(answered, days, today, cfg), todayQuestionId: designatedAt(quizzes, now)?.id ?? null };
}

// The months (YYYY-MM) in which this owner has completed at least one streak.
export const completedMonths = (s: StreakState): string[] => [...new Set(s.completedOn.map((d) => d.slice(0, 7)))];
