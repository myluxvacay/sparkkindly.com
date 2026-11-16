// @vitest-environment node
// The public leaderboard (Project 4.11, ADR 0004): only opted-in 16+ account holders appear, ranked by their own
// correct answers. A child profile's answers never count, Kids-world items never count, a hand-set flag on an
// under-age account still cannot appear, and ties share a rank.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { recordAnswer } from '@/lib/accounts/responses';
import { saveLeaderboardProfile } from '@/lib/accounts/leaderboard';
import { getPublicBoards } from '@/lib/public/leaderboard';
import { item } from '../helpers/circle-play';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-15T12:00:00Z');
const LAST_MONTH = new Date('2026-10-10T12:00:00Z');
let n = 0;
let playWorld = 0;
let kidsWorld = 0;

beforeAll(async () => {
  db = await newTestDb();
  const w = await db.query<{ id: number }>(
    "INSERT INTO worlds (slug, name, approval_mode) VALUES ('play', 'Play', 'auto'), ('kids', 'Kids', 'review') RETURNING id",
  );
  playWorld = w.rows[0].id;
  kidsWorld = w.rows[1].id;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM item_responses');
  await db.query('DELETE FROM items');
  await db.query('DELETE FROM accounts');
});

async function account(dob: string): Promise<string> {
  const r = await signUp(db, { email: `pb${n++}@example.test`, dateOfBirth: dob, parentEmail: 'parent@example.test' }, NOW);
  if (r.status !== 'created') throw new Error('sign-up failed');
  return r.accountId;
}
const optIn = (id: string, name: string) => saveLeaderboardProfile(db, id, { optIn: true, publicName: name, avatarKey: 'sunny' });
const answer = (accountId: string, itemId: string, at = NOW) =>
  recordAnswer(db, { accountId, profileId: null }, itemId, true, at);

describe('getPublicBoards', () => {
  it('ranks opted-in adults by their own correct answers, month and all time', async () => {
    const a = await account('1990-05-05');
    const b = await account('1988-01-01');
    await optIn(a, 'Alpha');
    await optIn(b, 'Beta');
    const p1 = await item(db, { world: playWorld });
    const p2 = await item(db, { world: playWorld });
    const p3 = await item(db, { world: playWorld });
    await answer(a, p1);
    await answer(a, p2, LAST_MONTH);
    await answer(b, p3);
    const boards = await getPublicBoards(db, NOW, a);
    expect(boards.allTime.map((r) => [r.rank, r.name, r.points, r.you])).toEqual([
      [1, 'Alpha', 20, true],
      [2, 'Beta', 10, false],
    ]);
    expect(boards.month.map((r) => [r.rank, r.name, r.points])).toEqual([
      [1, 'Alpha', 10],
      [1, 'Beta', 10],
    ]);
    // NOW is a Sunday and both in-month answers are this week; the October answer is neither month nor week.
    expect(boards.week.map((r) => [r.rank, r.name, r.points])).toEqual([
      [1, 'Alpha', 10],
      [1, 'Beta', 10],
    ]);
  });

  it('week board counts only answers since Monday 00:00 UTC', async () => {
    const a = await account('1990-05-05');
    const b = await account('1988-01-01');
    await optIn(a, 'Alpha');
    await optIn(b, 'Beta');
    const p1 = await item(db, { world: playWorld });
    const p2 = await item(db, { world: playWorld });
    const p3 = await item(db, { world: playWorld });
    // NOW is Sunday 2026-11-15; the week started Monday 2026-11-09T00:00:00Z.
    await answer(a, p1, new Date('2026-11-09T00:00:00Z')); // Monday boundary: counts.
    await answer(b, p2, new Date('2026-11-08T23:59:59Z')); // Previous Sunday night: last week, still this month.
    await answer(b, p3, NOW);
    const boards = await getPublicBoards(db, NOW, a);
    expect(boards.week.map((r) => [r.rank, r.name, r.points])).toEqual([
      [1, 'Alpha', 10],
      [1, 'Beta', 10],
    ]);
    expect(boards.month.map((r) => [r.rank, r.name, r.points])).toEqual([
      [1, 'Beta', 20],
      [2, 'Alpha', 10],
    ]);
    expect(boards.allTime.map((r) => [r.rank, r.name, r.points])).toEqual([
      [1, 'Beta', 20],
      [2, 'Alpha', 10],
    ]);
  });

  it('week board is right when now is a Monday', async () => {
    const a = await account('1990-05-05');
    await optIn(a, 'Alpha');
    const p1 = await item(db, { world: playWorld });
    const p2 = await item(db, { world: playWorld });
    // Monday 2026-11-16 at noon: yesterday (Sunday) is last week; Monday 00:00 exactly is this week.
    await answer(a, p1, new Date('2026-11-15T12:00:00Z'));
    await answer(a, p2, new Date('2026-11-16T00:00:00Z'));
    const monday = await getPublicBoards(db, new Date('2026-11-16T12:00:00Z'));
    expect(monday.week.map((r) => [r.name, r.points])).toEqual([['Alpha', 10]]);
    expect(monday.month.map((r) => [r.name, r.points])).toEqual([['Alpha', 20]]);
  });

  it('week board spans a month boundary: late last month can be this week', async () => {
    const a = await account('1990-05-05');
    await optIn(a, 'Alpha');
    const p1 = await item(db, { world: playWorld });
    // Sunday 2026-11-01: the week began Monday 2026-10-26, so the Oct 27 answer is this week, not this month.
    await answer(a, p1, new Date('2026-10-27T12:00:00Z'));
    const spanning = await getPublicBoards(db, new Date('2026-11-01T12:00:00Z'));
    expect(spanning.week.map((r) => [r.name, r.points])).toEqual([['Alpha', 10]]);
    expect(spanning.month).toEqual([]);
    expect(spanning.allTime.map((r) => [r.name, r.points])).toEqual([['Alpha', 10]]);
  });

  it('never shows the not-opted-in, the under-age, child answers or Kids items', async () => {
    const a = await account('1990-05-05');
    const quiet = await account('1992-02-02');
    const teen = await account('2012-06-01'); // 14 at NOW: never eligible, even with the flag set by hand below.
    await optIn(a, 'Alpha');
    await db.query(
      "UPDATE accounts SET leaderboard_opt_in = true, public_name = 'Teen', avatar_key = 'sunny' WHERE id = $1",
      [teen],
    );
    const p1 = await item(db, { world: playWorld });
    const k1 = await item(db, { world: kidsWorld });
    await answer(a, p1);
    await answer(a, k1); // Kids world: does not count.
    await answer(quiet, p1); // Not opted in.
    await answer(teen, p1); // Under-age.
    // Alpha's child profile answers the same item correctly: must not add to Alpha's score.
    const child = await db.query<{ id: string }>(
      "INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, 'Kid', '6-9') RETURNING id",
      [a],
    );
    await recordAnswer(db, { accountId: a, profileId: child.rows[0].id }, p1, true, NOW);
    const boards = await getPublicBoards(db, NOW);
    expect(boards.allTime).toEqual([
      { rank: 1, name: 'Alpha', avatarKey: 'sunny', points: 10, correct: 1, you: false, inviteKey: expect.any(String) },
    ]);
    // The week board draws on the same eligible set: nothing extra leaks through the new window.
    expect(boards.week).toEqual(boards.allTime);
    expect(boards.allTime[0].inviteKey).toMatch(/^[0-9a-f]{16}$/);
  });
});
