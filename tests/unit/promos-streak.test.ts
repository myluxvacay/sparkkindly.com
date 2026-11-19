// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { signUp } from '@/lib/accounts/signup';
import { recordAnswer } from '@/lib/accounts/responses';
import { computeStreak, designate, streakForOwner } from '@/lib/promos/streak';
import type { StreakConfig } from '@/lib/promos/types';

// The streak engine (lib/promos/streak.ts): the pure walk first (increments, wrong days, freeze, completion),
// then the database derivation — the designated Question of the Day per site-day and which saved answers count.

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

describe('designate', () => {
  const quiz = (id: string, day: string) => ({ id, published_at: new Date(`${day}T00:00:00Z`) });

  it('carries the latest quiz forward until a newer one publishes', () => {
    const { days: ds, byDay } = designate([quiz('b', '2026-11-03'), quiz('a', '2026-11-02')], '2026-11-04');
    expect(ds).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(byDay.get('2026-11-02')).toBe('a');
    expect(byDay.get('2026-11-03')).toBe('b');
    expect(byDay.get('2026-11-04')).toBe('b');
  });

  it('breaks a same-instant tie the way the public reads do (published_at desc, id asc)', () => {
    const { byDay } = designate([quiz('z', '2026-11-02'), quiz('a', '2026-11-02')], '2026-11-02');
    expect(byDay.get('2026-11-02')).toBe('a');
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
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     VALUES ($1,'quiz',$2,'T','S','{}'::jsonb,$3,'published',$4,'test','computable','test') RETURNING id`,
    [worldId, slug, audience, `${day}T00:00:00Z`],
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

  it('an adults-audience quiz is never designated, so the previous question carries forward', async () => {
    const me = await account();
    const owner = { accountId: me, profileId: null };
    const adultQuiz = await addQuiz('q-adults', days(12)[11], 'adults');
    await recordAnswer(db, owner, quizIds[11], true, new Date(`${days(12)[11]}T12:00:00Z`));
    const s = await streakForOwner(db, owner, new Date(`${days(12)[11]}T18:00:00Z`), CFG);
    expect(s.todayQuestionId).toBe(quizIds[11]);
    expect(s.todayQuestionId).not.toBe(adultQuiz);
    expect(s.todayDone).toBe(true);
  });
});
