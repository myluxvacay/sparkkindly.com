// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { signUp } from '@/lib/accounts/signup';
import { createChildProfile } from '@/lib/accounts/children';
import { recordAnswer } from '@/lib/accounts/responses';
import { byDesignation, computeStreak, designatedAt, siteDayOf, streakForOwner } from '@/lib/promos/streak';
import type { StreakConfig } from '@/lib/promos/types';

// The streak engine (lib/promos/streak.ts): the pure walk first (increments, wrong days, freeze, completion),
// then the site-day/designation model (06:00 UTC content days, the question the site is showing at the moment
// of the answer, per-viewer audiences), then the database derivation of which saved answers count.

const CFG: StreakConfig = { targetDays: 10, freezeAllowance: 1, winnersPerDraw: 5 };

// Consecutive UTC days starting 2026-11-02 (a Monday, but the engine only cares about order).
const days = (n: number, from = '2026-11-02') =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
const set = (...ds: string[]) => new Set(ds);

describe('computeStreak', () => {
  it('increments on each correctly answered day and reports today done', () => {
    const q = days(5);
    const s = computeStreak(set(q[0], q[1], q[2]), q, q[4], CFG);
    // Days 4 is a miss inside the run (freeze), day 5 (today) still open.
    expect(s.current).toBe(4);
    expect(s.todayDone).toBe(false);
    const s2 = computeStreak(set(q[0], q[1], q[2], q[4]), q, q[4], CFG);
    expect(s2.current).toBe(5);
    expect(s2.todayDone).toBe(true);
  });

  it('a day with no correct answer does not count', () => {
    const q = days(3);
    const s = computeStreak(set(q[0]), q, q[2], CFG);
    expect(s.current).toBe(2); // day 1 answered + day 2 frozen; today still open
    expect(s.best).toBe(2);
  });

  it('a missed day without a freeze left resets the run', () => {
    const cfg: StreakConfig = { targetDays: 10, freezeAllowance: 0, winnersPerDraw: 5 };
    const q = days(5);
    const s = computeStreak(set(q[0], q[1], q[3], q[4]), q, q[4], cfg);
    expect(s.current).toBe(2); // the miss on day 3 ended the first run; days 4-5 start a new one
    expect(s.best).toBe(2);
  });

  it('the freeze covers exactly one missed day per attempt, then a second miss breaks the run', () => {
    const q = days(8);
    // Answer 1-2, miss 3 (freeze), answer 4, miss 5 and 6 (break), answer 7, today 8 open.
    const s = computeStreak(set(q[0], q[1], q[3], q[6]), q, q[7], CFG);
    expect(s.current).toBe(1);
    expect(s.best).toBe(4);
    expect(s.freezeLeft).toBe(1); // the new attempt has its freeze back
  });

  it('a frozen day counts toward the run and can complete it', () => {
    const q = days(11);
    const answered = set(...q.slice(0, 9)); // 9 answers; day 10 is a past miss, day 11 is today
    const s = computeStreak(answered, q, q[10], CFG);
    expect(s.completedOn).toEqual([q[9]]); // the frozen day 10 is the tenth streak day
    expect(s.current).toBe(0);
    expect(s.best).toBe(10);
  });

  it('completes at exactly the target and starts a fresh attempt the next day', () => {
    const q = days(12);
    const s = computeStreak(set(...q.slice(0, 11)), q, q[11], CFG);
    expect(s.completedOn).toEqual([q[9]]);
    expect(s.current).toBe(1); // day 11 is the first day of the next attempt
    expect(s.freezeLeft).toBe(1);
  });

  it('today never breaks a run and never spends the freeze', () => {
    const q = days(4);
    const s = computeStreak(set(q[0], q[1], q[2]), q, q[3], CFG);
    expect(s.current).toBe(3);
    expect(s.freezeLeft).toBe(1);
  });

  it('no questions yet means no streak', () => {
    const s = computeStreak(set(), [], '2026-11-02', CFG);
    expect(s).toMatchObject({ current: 0, best: 0, completedOn: [] });
  });
});

describe('siteDayOf', () => {
  it('a site-day runs from the 06:00 UTC content slot to the next one', () => {
    expect(siteDayOf(new Date('2026-11-02T01:00:00Z'))).toBe('2026-11-01');
    expect(siteDayOf(new Date('2026-11-02T05:59:00Z'))).toBe('2026-11-01');
    expect(siteDayOf(new Date('2026-11-02T06:00:00Z'))).toBe('2026-11-02');
    expect(siteDayOf(new Date('2026-11-02T23:30:00Z'))).toBe('2026-11-02');
  });
});

describe('designatedAt', () => {
  const quiz = (id: string, iso: string) => ({ id, published_at: new Date(iso) });

  it('carries the latest quiz forward until a newer one publishes — no dead window before the slot', () => {
    const qs = byDesignation([quiz('b', '2026-11-03T06:00:00Z'), quiz('a', '2026-11-02T06:00:00Z')]);
    expect(designatedAt(qs, new Date('2026-11-02T05:00:00Z'))).toBeNull();
    expect(designatedAt(qs, new Date('2026-11-02T07:00:00Z'))?.id).toBe('a');
    // 01:00 UTC on Nov 3 is still Nov 2's site-day, and the site is still showing a: it is the designated one.
    expect(designatedAt(qs, new Date('2026-11-03T01:00:00Z'))?.id).toBe('a');
    expect(designatedAt(qs, new Date('2026-11-03T07:00:00Z'))?.id).toBe('b');
    expect(designatedAt(qs, new Date('2026-11-09T07:00:00Z'))?.id).toBe('b');
  });

  it('breaks a same-instant tie the way the public reads do (published_at desc, id asc)', () => {
    const qs = byDesignation([quiz('z', '2026-11-02T06:00:00Z'), quiz('a', '2026-11-02T06:00:00Z')]);
    expect(designatedAt(qs, new Date('2026-11-02T07:00:00Z'))?.id).toBe('a');
  });
});

// --- Database derivation -----------------------------------------------------

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
let n = 0;
let worldId = 0;
const quizIds: string[] = [];

async function addQuiz(slug: string, day: string, audience = 'all'): Promise<string> {
  return addQuizAt(slug, `${day}T00:00:00Z`, audience);
}

async function addQuizAt(slug: string, iso: string, audience = 'all'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     VALUES ($1,'quiz',$2,'T','S','{}'::jsonb,$3,'published',$4,'test','computable','test') RETURNING id`,
    [worldId, slug, audience, iso],
  );
  return r.rows[0].id;
}

async function account(): Promise<string> {
  const r = await signUp(db, { email: `s${n++}@example.test`, dateOfBirth: '1990-05-05' }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  return r.accountId;
}

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  worldId = (await db.query<{ id: number }>('SELECT id FROM worlds ORDER BY id LIMIT 1')).rows[0].id;
  // One designated quiz per day for 2026-11-02 .. 2026-11-13.
  for (const d of days(12)) quizIds.push(await addQuiz(`q-${d}`, d));
});

afterAll(async () => {
  await db.close();
});

describe('streakForOwner', () => {
  it('counts only correct answers to that day’s designated question, given that day', async () => {
    const me = await account();
    const owner = { accountId: me, profileId: null };
    // Correct on days 1-3 (answered on the day).
    for (let i = 0; i < 3; i++) {
      await recordAnswer(db, owner, quizIds[i], true, new Date(`${days(12)[i]}T12:00:00Z`));
    }
    // Day 4's question answered correctly but a day late (on day 5): does not count for day 4 or day 5.
    await recordAnswer(db, owner, quizIds[3], true, new Date(`${days(12)[4]}T09:00:00Z`));
    // Day 5: a correct answer to some other (older) question does not count either.
    await recordAnswer(db, owner, quizIds[0], true, new Date(`${days(12)[4]}T10:00:00Z`));
    const s = await streakForOwner(db, owner, new Date(`${days(12)[4]}T18:00:00Z`), CFG);
    expect(s.todayQuestionId).toBe(quizIds[4]);
    expect(s.todayDone).toBe(false);
    // Days 1-3 answered, day 4 frozen, day 5 (today) open.
    expect(s.current).toBe(4);
    expect(s.freezeLeft).toBe(0);
  });

  it('a wrong first answer never counts, even though it is the saved one', async () => {
    const me = await account();
    const owner = { accountId: me, profileId: null };
    await recordAnswer(db, owner, quizIds[0], false, new Date(`${days(12)[0]}T12:00:00Z`));
    await recordAnswer(db, owner, quizIds[1], true, new Date(`${days(12)[1]}T12:00:00Z`));
    const s = await streakForOwner(db, owner, new Date(`${days(12)[1]}T18:00:00Z`), CFG);
    expect(s.current).toBe(1);
    expect(s.todayDone).toBe(true);
  });

  it('completes after ten counted days and reports the completion date', async () => {
    const me = await account();
    const owner = { accountId: me, profileId: null };
    for (let i = 0; i < 10; i++) {
      await recordAnswer(db, owner, quizIds[i], true, new Date(`${days(12)[i]}T12:00:00Z`));
    }
    const s = await streakForOwner(db, owner, new Date(`${days(12)[10]}T09:00:00Z`), CFG);
    expect(s.completedOn).toEqual([days(12)[9]]);
    expect(s.best).toBe(10);
    expect(s.current).toBe(0); // day 11 still open, new attempt not started
  });

  it('designation follows the viewer: a holder’s daily question can be an adults-audience quiz', async () => {
    const me = await account();
    const owner = { accountId: me, profileId: null };
    // The adults quiz publishes after that day's all-audience quiz, so it is what /quiz/ shows a holder.
    const adultQuiz = await addQuizAt('q-adults', `${days(12)[11]}T06:00:00Z`, 'adults');
    await recordAnswer(db, owner, adultQuiz, true, new Date(`${days(12)[11]}T12:00:00Z`));
    const s = await streakForOwner(db, owner, new Date(`${days(12)[11]}T18:00:00Z`), CFG);
    expect(s.todayQuestionId).toBe(adultQuiz);
    expect(s.todayDone).toBe(true);
  });

  it('…but a child profile never gets the adults quiz: the previous visible question carries forward for them', async () => {
    const me = await account();
    const child = await createChildProfile(
      db,
      me,
      { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: true, pin: '1234' },
      T0,
    );
    if (child.status !== 'created') throw new Error('profile failed');
    const owner = { accountId: me, profileId: child.profileId };
    await recordAnswer(db, owner, quizIds[11], true, new Date(`${days(12)[11]}T12:00:00Z`));
    const s = await streakForOwner(db, owner, new Date(`${days(12)[11]}T18:00:00Z`), CFG);
    expect(s.todayQuestionId).toBe(quizIds[11]);
    expect(s.todayDone).toBe(true);
  });

  it('the 06:00 boundary: an answer after midnight UTC still belongs to the site-day whose question it was', async () => {
    const a = await addQuizAt('b-a', '2026-11-14T06:00:00Z');
    const b = await addQuizAt('b-b', '2026-11-15T06:00:00Z');
    const now = new Date('2026-11-15T12:00:00Z');
    // 01:00 UTC on Nov 15: the site is still showing Nov 14's question (b publishes at 06:00). Answering it
    // correctly counts for Nov 14's site-day.
    const early = await account();
    await recordAnswer(db, { accountId: early, profileId: null }, a, true, new Date('2026-11-15T01:00:00Z'));
    const sEarly = await streakForOwner(db, { accountId: early, profileId: null }, now, CFG);
    expect(sEarly.current).toBe(1);
    expect(sEarly.todayDone).toBe(false);
    // Answering tomorrow's question before it is the site's question counts for nothing.
    const eager = await account();
    await recordAnswer(db, { accountId: eager, profileId: null }, b, true, new Date('2026-11-15T02:00:00Z'));
    const sEager = await streakForOwner(db, { accountId: eager, profileId: null }, now, CFG);
    expect(sEager.current).toBe(0);
    expect(sEager.todayDone).toBe(false);
    // After the slot, the new question is today's, and answering it counts today.
    const onTime = await account();
    await recordAnswer(db, { accountId: onTime, profileId: null }, b, true, new Date('2026-11-15T07:00:00Z'));
    const sOnTime = await streakForOwner(db, { accountId: onTime, profileId: null }, now, CFG);
    expect(sOnTime.current).toBe(1);
    expect(sOnTime.todayDone).toBe(true);
  });

  it('a sinceDay bound (a promotion’s start) keeps earlier days out of the count', async () => {
    const me = await account();
    const owner = { accountId: me, profileId: null };
    for (let i = 0; i < 10; i++) {
      await recordAnswer(db, owner, quizIds[i], true, new Date(`${days(12)[i]}T12:00:00Z`));
    }
    const now = new Date(`${days(12)[10]}T09:00:00Z`);
    const unbounded = await streakForOwner(db, owner, now, CFG);
    expect(unbounded.completedOn).toEqual([days(12)[9]]);
    // Starting the count on day 6 leaves only five answered days (6–10): no completion, run still live.
    const bounded = await streakForOwner(db, owner, now, CFG, { sinceDay: days(12)[5] });
    expect(bounded.completedOn).toEqual([]);
    expect(bounded.current).toBe(5);
  });
});
