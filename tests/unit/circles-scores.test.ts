// @vitest-environment node
// Circle scores (plan 4C Task 2): derived on read from item_responses joined to the circle's sets; correct answers made
// within the circle day only; competition ranks; former members kept; members only; never the chosen answer.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { adult, childIn, circleOf, fixtures, item, join, type Fixtures } from '../helpers/circle-play';
import { recordAnswer } from '@/lib/accounts/responses';
import { deleteAccount } from '@/lib/accounts/delete';
import { leaveCircle } from '@/lib/circles/repo';
import { runAction } from '@/lib/admin/actions';
import { getOrCreateDailySet } from '@/lib/circles/daily-set';
import { getTallies, rankWithTies, type Board } from '@/lib/circles/scores';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let f: Fixtures;
const NOW = new Date('2026-11-05T12:00:00Z');
const ADMIN = { email: 'owner@example.test' };

beforeAll(async () => {
  db = await newTestDb();
  f = await fixtures(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM circles');
  await db.query('DELETE FROM items');
  await db.query('DELETE FROM site_settings');
});

const answer = (accountId: string, profileId: string | null, itemId: string, correct: boolean, at = NOW) =>
  recordAnswer(db, { accountId, profileId }, itemId, correct, at);
const pts = (b: Board) => b.map((r) => [r.name, r.points, r.rank]);

// A family circle: Mum (owner), Bea (adult member), Mia (Mum's child); five `all` items in today's set.
async function family(timeZone?: string) {
  const mum = await adult(db);
  const bea = await adult(db);
  const c = await circleOf(db, mum, { timeZone });
  await join(db, c.slug, bea, 'Bea');
  const mia = await childIn(db, mum, c.slug, 'Mia');
  for (let i = 0; i < 5; i++) await item(db, { world: f.worlds.a });
  const set = (await getOrCreateDailySet(db, c.id, NOW)).map((s) => s.itemId);
  return { mum, bea, mia, ...c, set };
}

describe('rankWithTies', () => {
  it('gives competition ranks: ties share, the next rank skips', () => {
    expect(rankWithTies([30, 30, 10])).toEqual([1, 1, 3]);
    expect(rankWithTies([0, 0, 0])).toEqual([1, 1, 1]);
    expect(rankWithTies([5])).toEqual([1]);
    expect(rankWithTies([])).toEqual([]);
  });

  it('property: with points descending, ranks are non-decreasing, equal points share a rank, rank = 1 + count above', () => {
    for (let run = 0; run < 200; run++) {
      const points = Array.from({ length: 1 + (run % 12) }, () => 10 * Math.floor(Math.random() * 4)).sort((a, b) => b - a);
      const ranks = rankWithTies(points);
      points.forEach((p, i) => {
        expect(ranks[i]).toBe(1 + points.filter((q) => q > p).length);
        if (i > 0) expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
        if (i > 0 && points[i - 1] === p) expect(ranks[i]).toBe(ranks[i - 1]);
      });
    }
  });
});

describe('getTallies', () => {
  it('scores correct set answers in the circle day, 10 each; wrong, unanswered and other days score 0; ties share', async () => {
    const c = await family();
    for (const i of c.set.slice(0, 3)) await answer(c.mum, null, i, true);
    await answer(c.mum, null, c.set[3], false);
    for (const i of c.set.slice(0, 3)) await answer(c.mum, c.mia, i, true);
    // Bea answered the day before the set: does not count.
    await answer(c.bea, null, c.set[0], true, new Date('2026-11-04T23:00:00Z'));
    const t = (await getTallies(db, c.mum, null, c.slug, NOW))!;
    expect(pts(t.day)).toEqual([['Mum', 30, 1], ['Mia', 30, 1], ['Bea', 0, 3]]);
    expect(t.day.map((r) => r.you)).toEqual([true, false, false]);
    expect(pts(t.allTime)).toEqual(pts(t.day));
    expect(t.circleTotals).toEqual({ day: 60, week: 60, month: 60, allTime: 60 });
  });

  it('zero points everywhere and a one-member circle rank sanely', async () => {
    const solo = await adult(db);
    const c = await circleOf(db, solo, { kind: 'friends', name: 'Solo' });
    const t = (await getTallies(db, solo, null, c.slug, NOW))!;
    expect(t.day).toEqual([{ rank: 1, name: 'Solo', points: 0, former: false, you: true }]);
    expect(t.circleTotals.allTime).toBe(0);
  });

  it('a left member is shown as "Former member" and keeps points; a deleted account vanishes and ranks recompute', async () => {
    const c = await family();
    await answer(c.bea, null, c.set[0], true);
    await answer(c.bea, null, c.set[1], true);
    await answer(c.mum, null, c.set[0], true);
    expect(await leaveCircle(db, c.bea, c.slug, NOW)).toBe('left');
    let t = (await getTallies(db, c.mum, null, c.slug, NOW))!;
    expect(t.day.map((r) => [r.name, r.points, r.rank, r.former])).toEqual([
      ['Former member', 20, 1, true],
      ['Mum', 10, 2, false],
      ['Mia', 0, 3, false],
    ]);
    expect(await getTallies(db, c.bea, null, c.slug, NOW)).toBeNull();
    await deleteAccount(db, c.bea, NOW);
    t = (await getTallies(db, c.mum, null, c.slug, NOW))!;
    expect(pts(t.day)).toEqual([['Mum', 10, 1], ['Mia', 0, 2]]);
    expect(t.circleTotals.day).toBe(10);
  });

  it('day, ISO week, month and all time follow the circle time zone, including a week across a month end', async () => {
    const mum = await adult(db);
    const c = await circleOf(db, mum, { timeZone: 'Pacific/Auckland', kind: 'friends' });
    for (let i = 0; i < 15; i++) await item(db, { world: f.worlds.a });
    // Local days (UTC+13): Sun 29 Nov (last week), Mon 30 Nov and Tue 1 Dec (this ISO week, two months).
    const days = ['2026-11-28T12:00:00Z', '2026-11-29T12:00:00Z', '2026-11-30T12:00:00Z'].map((d) => new Date(d));
    for (const at of days) {
      const set = await getOrCreateDailySet(db, c.id, at);
      await answer(mum, null, set[0].itemId, true, at);
    }
    // 1 Dec 00:30 local is still 30 Nov in UTC: counted as 1 Dec.
    const late = (await getOrCreateDailySet(db, c.id, new Date('2026-11-30T11:30:00Z')))[1];
    await answer(mum, null, late.itemId, true, new Date('2026-11-30T11:30:00Z'));
    const t = (await getTallies(db, mum, null, c.slug, days[2]))!;
    expect(t.circleTotals).toEqual({ day: 20, week: 30, month: 20, allTime: 40 });
  });

  it('an adults item scores while the circle has no child and stops scoring the moment a child joins', async () => {
    const mum = await adult(db);
    const c = await circleOf(db, mum);
    const adultsItem = await item(db, { world: f.worlds.a, audience: 'adults' });
    await getOrCreateDailySet(db, c.id, NOW);
    await answer(mum, null, adultsItem, true);
    expect((await getTallies(db, mum, null, c.slug, NOW))!.circleTotals.day).toBe(10);
    await childIn(db, mum, c.slug);
    expect((await getTallies(db, mum, null, c.slug, NOW))!.circleTotals.day).toBe(0);
  });

  it('members only: a stranger, a forged slug, a profile not in the circle or of another account get null', async () => {
    const c = await family();
    const stranger = await adult(db);
    expect(await getTallies(db, stranger, null, c.slug, NOW)).toBeNull();
    expect(await getTallies(db, c.mum, null, 'zzzzzzzzzz', NOW)).toBeNull();
    expect(await getTallies(db, c.mum, null, '../x', NOW)).toBeNull();
    // Bea's account with Mum's child's profile id: refused.
    expect(await getTallies(db, c.bea, c.mia, c.slug, NOW)).toBeNull();
    // A child profile of Mum's that is not in the circle.
    const leo = (
      await db.query<{ id: string }>("INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, 'Leo', '6-9') RETURNING id", [c.mum])
    ).rows[0].id;
    expect(await getTallies(db, c.mum, leo, c.slug, NOW)).toBeNull();
    expect(await getTallies(db, c.mum, 'not-a-uuid', c.slug, NOW)).toBeNull();
  });

  it('a child profile reads the board of its own circle, marked as itself, and never a chosen answer', async () => {
    const c = await family();
    await answer(c.mum, c.mia, c.set[0], true);
    const t = (await getTallies(db, c.mum, c.mia, c.slug, NOW))!;
    expect(t.day.find((r) => r.you)).toMatchObject({ name: 'Mia', points: 10 });
    const keys = new Set<string>();
    JSON.stringify(t, (k, v) => (keys.add(k), v));
    for (const k of ['choice', 'answer', 'correct', 'accountId', 'profileId', 'email', 'itemId']) expect(keys.has(k)).toBe(false);
  });

  it('the points setting changes totals, is audited, and is bounded 0 to 100', async () => {
    const c = await family();
    await answer(c.mum, null, c.set[0], true);
    expect(await runAction(db, ADMIN, 'scoring.set_points', new URLSearchParams({ points: '25' }), NOW)).toMatchObject({ ok: true });
    expect((await getTallies(db, c.mum, null, c.slug, NOW))!.circleTotals.day).toBe(25);
    const audit = await db.query<{ action: string; detail: { points: number } }>(
      "SELECT action, detail FROM audit_log WHERE action = 'scoring.set_points' ORDER BY id DESC LIMIT 1",
    );
    expect(audit.rows[0]).toEqual({ action: 'scoring.set_points', detail: { points: 25 } });
    for (const bad of ['101', '-1', 'x', '1.5', '', '0100']) {
      expect(await runAction(db, ADMIN, 'scoring.set_points', new URLSearchParams({ points: bad }), NOW), bad).toMatchObject({ ok: false });
    }
    expect(await runAction(db, ADMIN, 'scoring.set_points', new URLSearchParams({ points: '0' }), NOW)).toMatchObject({ ok: true });
    expect((await getTallies(db, c.mum, null, c.slug, NOW))!.circleTotals.day).toBe(0);
  });
});
