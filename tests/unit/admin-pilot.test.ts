// @vitest-environment node
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createItem } from '@/lib/items/repo';
import { operatingEffort, pilotMetrics, recentHours } from '@/lib/admin/pilot';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let playId: number;
let n = 0;
const NOW = new Date('2026-11-30T12:00:00Z');
const day = (d: number, h = 10) => new Date(Date.UTC(2026, 10, d, h)).toISOString(); // November 2026

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  playId = (await db.query<{ id: number }>("SELECT id FROM worlds WHERE slug = 'play'")).rows[0].id;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec('DELETE FROM item_responses; DELETE FROM profile_interests; DELETE FROM audit_log; DELETE FROM items; DELETE FROM accounts;');
});

async function account(createdAt: string, verified = true): Promise<string> {
  const r = await db.query<{ id: string }>(
    "INSERT INTO accounts (email, date_of_birth, created_at, verified_at) VALUES ($1, '2005-01-01', $2, $3) RETURNING id",
    [`m${++n}@example.test`, createdAt, verified ? createdAt : null],
  );
  return r.rows[0].id;
}
async function item(): Promise<string> {
  return (
    await createItem(db, {
      worldId: playId, kind: 'article', slug: `p-${++n}`, title: 'T', summary: 'S', body: {}, audience: 'all',
      createdBy: 'test', riskTier: 'reflective',
    })
  ).id;
}
async function answer(acc: string, at: string) {
  await db.query('INSERT INTO item_responses (account_id, item_id, correct, answered_at) VALUES ($1, $2, true, $3)', [acc, await item(), at]);
}

describe('pilotMetrics', () => {
  it('reports no data, never a pass or a division by zero, with no members', async () => {
    const m = await pilotMetrics(db, NOW);
    for (const k of ['activation', 'returning', 'interestUptake', 'quality'] as const) {
      expect(m[k]).toMatchObject({ denominator: 0, percent: null, met: null });
    }
    expect(m.members).toBe(0);
  });

  it('activation counts answers within 7 days of sign-up and excludes unverified and out-of-window accounts', async () => {
    const a = await account(day(10));
    const b = await account(day(10));
    const late = await account(day(10));
    await account(day(10));
    await account(day(10), false);
    await account('2026-09-01T00:00:00Z');
    await answer(a, day(12));
    await answer(b, day(13));
    await answer(late, day(18, 11)); // 8 days + 1 hour
    const m = await pilotMetrics(db, NOW);
    expect(m.members).toBe(4);
    expect(m.activation).toMatchObject({ numerator: 2, denominator: 4, percent: 50, threshold: 40, met: true });
  });

  it('return needs an answer on a later UTC day within 7 days of the first, from members whose first answer is 7+ days old', async () => {
    const back = await account(day(1));
    await answer(back, day(2));
    await answer(back, day(5));
    const sameDay = await account(day(1));
    await answer(sameDay, day(2, 8));
    await answer(sameDay, day(2, 20));
    const dayEight = await account(day(1));
    await answer(dayEight, day(2, 10));
    await answer(dayEight, day(10, 11));
    const tooNew = await account(day(27));
    await answer(tooNew, day(28));
    await answer(tooNew, day(29));
    const m = await pilotMetrics(db, NOW, 40);
    expect(m.returning).toMatchObject({ numerator: 1, denominator: 3, threshold: 30, met: true });
    expect(m.returning.percent).toBeCloseTo(33.3, 1);
  });

  it('interest uptake counts topic or world interests and ignores child-profile interests', async () => {
    const topic = await account(day(10));
    const world = await account(day(10));
    const childOnly = await account(day(10));
    const topicId = (await db.query<{ id: number }>('SELECT id FROM topics LIMIT 1')).rows[0].id;
    await db.query('INSERT INTO profile_interests (account_id, topic_id) VALUES ($1, $2)', [topic, topicId]);
    await db.query('INSERT INTO profile_interests (account_id, world_id) VALUES ($1, $2)', [world, playId]);
    const prof = (
      await db.query<{ id: string }>("INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, 'Kid', '6-9') RETURNING id", [childOnly])
    ).rows[0].id;
    await db.query('INSERT INTO profile_interests (account_id, profile_id, topic_id) VALUES ($1, $2, $3)', [childOnly, prof, topicId]);
    const m = await pilotMetrics(db, NOW);
    expect(m.interestUptake).toMatchObject({ numerator: 2, denominator: 3, threshold: 60, met: true });
  });

  it('quality counts unpublish and edit audit rows on published items only, per 100 published items', async () => {
    const published: string[] = [];
    for (let i = 0; i < 100; i++) published.push(await item());
    await db.query('UPDATE items SET published_at = $2 WHERE id = ANY($1::uuid[])', [published, day(15)]);
    const draft = await item();
    const log = (action: string, target: string) =>
      db.query("INSERT INTO audit_log (at, actor, action, target) VALUES ($1, 'o', $2, $3)", [day(20), action, target]);
    await log('item.edit', published[0]);
    await log('item.unpublish', published[1]);
    await log('item.edit', draft); // never published: ignored
    await log('item.edit', 'world:play'); // not an item id: ignored
    let m = await pilotMetrics(db, NOW);
    expect(m.quality).toMatchObject({ numerator: 2, denominator: 100, per100: 2, threshold: 2, met: false });
    await db.query("DELETE FROM audit_log WHERE action = 'item.unpublish'");
    m = await pilotMetrics(db, NOW);
    expect(m.quality).toMatchObject({ numerator: 1, per100: 1, met: true });
  });

  it('exposes only aggregates: no email or id fields', async () => {
    await account(day(10));
    const json = JSON.stringify(await pilotMetrics(db, NOW));
    expect(json).not.toMatch(/@|email|"id"|account_id/);
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(['activation', 'interestUptake', 'members', 'quality', 'returning']);
  });
});

describe('operating hours', () => {
  beforeEach(async () => {
    await db.exec('DELETE FROM operating_hours');
  });
  const log = (week: string, hours: number) => db.query('INSERT INTO operating_hours (week_start, hours) VALUES ($1, $2)', [week, hours]);

  it('has no verdict without logged weeks', async () => {
    expect(await operatingEffort(db, NOW)).toEqual({ weeks: 0, average: null, threshold: 2, met: null });
  });

  it('averages only the last 4 logged weeks and is met when under 2 hours', async () => {
    for (const [w, h] of [['2026-10-05', 40], ['2026-10-26', 1], ['2026-11-02', 2], ['2026-11-09', 2], ['2026-11-16', 2.5]] as const) await log(w, h);
    expect(await operatingEffort(db, NOW)).toEqual({ weeks: 4, average: 1.9, threshold: 2, met: true });
    await log('2026-11-23', 4);
    expect(await operatingEffort(db, NOW)).toMatchObject({ average: 2.6, met: false });
  });

  it('lists the most recent weeks first, limited', async () => {
    for (let i = 1; i <= 9; i++) await log(`2026-0${i}-05`, i);
    const rows = await recentHours(db, 8);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ weekStart: '2026-09-05', hours: 9 });
  });
});
