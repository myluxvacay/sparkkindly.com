// @vitest-environment node
// The circle daily set (plan 4C Task 1): five playable items a day from the circle's topics and worlds, filled with bonus
// items, fixed once made, avoiding the previous 14 days, and never an `adults` item while a child is in the circle.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { adult, childIn, circleOf, fixtures, item, type Fixtures } from '../helpers/circle-play';
import { setCircleInterests } from '@/lib/circles/interests';
import { SET_SIZE, circleDay, getOrCreateDailySet, orderCandidates } from '@/lib/circles/daily-set';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let f: Fixtures;
const NOW = new Date('2026-11-05T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

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
});

const ids = (set: { itemId: string }[]) => set.map((s) => s.itemId);
const many = (n: number, o: Parameters<typeof item>[1]) => Promise.all(Array.from({ length: n }, () => item(db, o)));

describe('circleDay', () => {
  it('is the calendar date in the circle time zone, rolling over at local midnight', () => {
    expect(circleDay('UTC', new Date('2026-11-05T23:59:59Z'))).toBe('2026-11-05');
    expect(circleDay('UTC', new Date('2026-11-06T00:00:00Z'))).toBe('2026-11-06');
    // Auckland is UTC+13 in November.
    expect(circleDay('Pacific/Auckland', new Date('2026-11-05T10:59:59Z'))).toBe('2026-11-05');
    expect(circleDay('Pacific/Auckland', new Date('2026-11-05T11:00:00Z'))).toBe('2026-11-06');
    // Los Angeles is UTC-8 after 1 November 2026.
    expect(circleDay('America/Los_Angeles', new Date('2026-11-06T07:59:59Z'))).toBe('2026-11-05');
    expect(circleDay('America/Los_Angeles', new Date('2026-11-06T08:00:00Z'))).toBe('2026-11-06');
    // The same instant is a different day in the two zones.
    const t = new Date('2026-11-05T12:00:00Z');
    expect([circleDay('Pacific/Auckland', t), circleDay('America/Los_Angeles', t)]).toEqual(['2026-11-06', '2026-11-05']);
  });
});

describe('orderCandidates', () => {
  it('is a deterministic permutation that depends on circle and day', () => {
    const list = Array.from({ length: 20 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const a = orderCandidates('c1', '2026-11-05', list);
    expect(orderCandidates('c1', '2026-11-05', [...list].reverse())).toEqual(a);
    expect([...a].sort()).toEqual([...list].sort());
    expect(orderCandidates('c1', '2026-11-06', list)).not.toEqual(a);
    expect(orderCandidates('c2', '2026-11-05', list)).not.toEqual(a);
    expect(orderCandidates('c1', '2026-11-05', [])).toEqual([]);
  });
});

describe('getOrCreateDailySet', () => {
  it('takes five items from the chosen topics, not bonus, and returns the same set on every call', async () => {
    const owner = await adult(db);
    const c = await circleOf(db, owner);
    const fromTopic = await many(7, { world: f.worlds.c, topics: [f.topics.x] });
    await many(5, { world: f.worlds.a });
    await setCircleInterests(db, owner, c.slug, { worldIds: [], topicIds: [f.topics.x] });
    const set = await getOrCreateDailySet(db, c.id, NOW);
    expect(set).toHaveLength(SET_SIZE);
    for (const s of set) expect(fromTopic).toContain(s.itemId);
    expect(set.every((s) => !s.bonus)).toBe(true);
    expect(set.map((s) => s.position)).toEqual([1, 2, 3, 4, 5]);
    expect(set[0]).toMatchObject({ worldSlug: 'wc', kind: 'quiz', title: expect.stringMatching(/^Item/), slug: expect.any(String) });
    expect(ids(await getOrCreateDailySet(db, c.id, NOW))).toEqual(ids(set));
    expect(ids(await getOrCreateDailySet(db, c.id, new Date('2026-11-05T23:59:59Z')))).toEqual(ids(set));
  });

  it('fills from the chosen worlds and then any world, flagged bonus', async () => {
    const owner = await adult(db);
    const c = await circleOf(db, owner);
    const topic = await item(db, { world: f.worlds.c, topics: [f.topics.x] });
    const inWorld = await many(2, { world: f.worlds.a });
    const other = await many(4, { world: f.worlds.b });
    await setCircleInterests(db, owner, c.slug, { worldIds: [f.worlds.a], topicIds: [f.topics.x] });
    const set = await getOrCreateDailySet(db, c.id, NOW);
    expect(set).toHaveLength(5);
    // The topic item is in world c, outside the chosen world, so it counts as an any-world bonus item.
    const notBonus = set.filter((s) => !s.bonus).map((s) => s.itemId);
    expect(notBonus).toEqual([]);
    expect(ids(set).filter((i) => inWorld.includes(i))).toHaveLength(2);
    expect(ids(set).slice(0, 2).sort()).toEqual([...inWorld].sort());
    expect(ids(set).filter((i) => other.includes(i) || i === topic)).toHaveLength(3);
  });

  it('a topic item in a chosen world is not bonus; with no interests every world counts', async () => {
    const owner = await adult(db);
    const c = await circleOf(db, owner);
    const match = await item(db, { world: f.worlds.a, topics: [f.topics.x] });
    await many(3, { world: f.worlds.b });
    await setCircleInterests(db, owner, c.slug, { worldIds: [f.worlds.a], topicIds: [f.topics.x] });
    const set = await getOrCreateDailySet(db, c.id, NOW);
    expect(set[0]).toMatchObject({ itemId: match, bonus: false });
    expect(set.slice(1).every((s) => s.bonus)).toBe(true);
    const plain = await circleOf(db, owner, { kind: 'friends' });
    expect((await getOrCreateDailySet(db, plain.id, NOW)).every((s) => !s.bonus)).toBe(true);
  });

  it('with fewer than five playable items, returns what exists; only published playable items with answers qualify', async () => {
    const owner = await adult(db);
    const c = await circleOf(db, owner);
    const quiz = await item(db, { world: f.worlds.a });
    const game = await item(db, { world: f.worlds.a, kind: 'game' });
    await item(db, { world: f.worlds.a, status: 'draft' });
    await item(db, { world: f.worlds.a, kind: 'article', body: { sections: [] } });
    await item(db, { world: f.worlds.a, kind: 'puzzle' });
    await item(db, { world: f.worlds.a, answer: null });
    const set = await getOrCreateDailySet(db, c.id, NOW);
    expect(ids(set).sort()).toEqual([quiz, game].sort());
  });

  it('the next day differs and avoids the previous 14 days when enough items exist', async () => {
    const owner = await adult(db);
    const c = await circleOf(db, owner);
    await many(10, { world: f.worlds.a });
    const d0 = ids(await getOrCreateDailySet(db, c.id, NOW));
    const d1 = ids(await getOrCreateDailySet(db, c.id, day(1)));
    expect(d1.filter((i) => d0.includes(i))).toEqual([]);
    // Day 2: everything was shown in the last 14 days, so it reuses items rather than come up short.
    expect(await getOrCreateDailySet(db, c.id, day(2))).toHaveLength(5);
    // A fresh item is preferred over recently shown ones.
    const fresh = await item(db, { world: f.worlds.a });
    expect(ids(await getOrCreateDailySet(db, c.id, day(3)))).toContain(fresh);
  });

  it('a circle with a child never gets an adults item, and adding a child hides one already in the stored set', async () => {
    const owner = await adult(db);
    const withChild = await circleOf(db, owner);
    await childIn(db, owner, withChild.slug);
    const adultsOnly = await many(5, { world: f.worlds.a, audience: 'adults' });
    const safe = await many(2, { world: f.worlds.a, audience: 'all' });
    const kids = await item(db, { world: f.worlds.a, audience: 'kids' });
    const set = ids(await getOrCreateDailySet(db, withChild.id, NOW));
    expect(set.sort()).toEqual([...safe, kids].sort());

    const later = await circleOf(db, owner, { name: 'Dad' });
    const before = ids(await getOrCreateDailySet(db, later.id, NOW));
    expect(before.some((i) => adultsOnly.includes(i))).toBe(true);
    await childIn(db, owner, later.slug, 'Leo');
    const after = ids(await getOrCreateDailySet(db, later.id, NOW));
    expect(after.some((i) => adultsOnly.includes(i))).toBe(false);
    expect(after).toEqual(before.filter((i) => !adultsOnly.includes(i)));
  });

  it('concurrent first calls create one set', async () => {
    const owner = await adult(db);
    const c = await circleOf(db, owner);
    await many(8, { world: f.worlds.a });
    const runs = await Promise.all(Array.from({ length: 4 }, () => getOrCreateDailySet(db, c.id, NOW)));
    for (const r of runs) expect(ids(r)).toEqual(ids(runs[0]));
    const n = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM circle_daily_sets WHERE circle_id = $1', [c.id]);
    expect(n.rows[0].n).toBe(5);
  });
});
