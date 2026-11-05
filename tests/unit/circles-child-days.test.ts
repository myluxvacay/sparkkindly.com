// @vitest-environment node
// 4C review M2: a set day on which a child profile was in the circle stays child-safe after the child leaves: its
// `adults` items stay hidden and score nothing; only later days get the full scope again.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { adult, childIn, circleOf, fixtures, item, type Fixtures } from '../helpers/circle-play';
import { recordAnswer } from '@/lib/accounts/responses';
import { getOrCreateDailySet, readSet } from '@/lib/circles/daily-set';
import { addChildToCircle, removeChildFromCircle } from '@/lib/circles/children';
import { getTallies } from '@/lib/circles/scores';
import { purgeClosedCircles } from '@/lib/jobs/circles-purge';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let f: Fixtures;
const D1 = new Date('2026-11-05T10:00:00Z');
const D1_LATER = new Date('2026-11-05T11:00:00Z');
const D3 = new Date('2026-11-07T10:00:00Z');
const D4 = new Date('2026-11-08T10:00:00Z');

beforeAll(async () => {
  db = await newTestDb();
  f = await fixtures(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM circles');
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM items');
});

async function setup() {
  const adultsItem = await item(db, { world: f.worlds.a, audience: 'adults' });
  const mum = await adult(db);
  const c = await circleOf(db, mum, { kind: 'family' });
  return { adultsItem, mum, c };
}
const allTime = async (mum: string, slug: string, at: Date) => (await getTallies(db, mum, null, slug, at))!.circleTotals.allTime;

describe('child days', () => {
  it('a day a child overlapped keeps no adults items and scores 0 after the child is removed; later days are full again', async () => {
    const { adultsItem, mum, c } = await setup();
    expect((await getOrCreateDailySet(db, c.id, D1)).map((s) => s.itemId)).toEqual([adultsItem]);
    await recordAnswer(db, { accountId: mum, profileId: null }, adultsItem, true, D1);
    expect(await allTime(mum, c.slug, D1)).toBe(10);

    const kid = await childIn(db, mum, c.slug, 'Mia');
    await db.query('UPDATE circle_members SET joined_at = $2 WHERE profile_id = $1', [kid, D1_LATER.toISOString()]);
    expect(await readSet(db, c.id, '2026-11-05', D1_LATER)).toEqual([]);
    expect(await allTime(mum, c.slug, D1_LATER)).toBe(0);

    expect(await removeChildFromCircle(db, mum, c.slug, kid, D3)).toBe(true);
    expect(await readSet(db, c.id, '2026-11-05', D3)).toEqual([]);
    expect(await allTime(mum, c.slug, D3)).toBe(0);

    const later = await item(db, { world: f.worlds.a, audience: 'adults' });
    const set = (await getOrCreateDailySet(db, c.id, D4)).map((s) => s.itemId);
    expect(set.length).toBeGreaterThan(0);
    expect(set.every((id) => [adultsItem, later].includes(id))).toBe(true);
    await recordAnswer(db, { accountId: mum, profileId: null }, set.includes(later) ? later : adultsItem, true, D4);
    expect(await allTime(mum, c.slug, D4)).toBe(10);
    expect(await readSet(db, c.id, '2026-11-05', D4)).toEqual([]);
  });

  it('re-adding and removing the child again, or deleting the profile, never brings a child day back', async () => {
    const { adultsItem, mum, c } = await setup();
    await getOrCreateDailySet(db, c.id, D1);
    await recordAnswer(db, { accountId: mum, profileId: null }, adultsItem, true, D1);
    const kid = await childIn(db, mum, c.slug, 'Mia');
    await db.query('UPDATE circle_members SET joined_at = $2 WHERE profile_id = $1', [kid, D1_LATER.toISOString()]);
    expect(await removeChildFromCircle(db, mum, c.slug, kid, D1_LATER)).toBe(true);
    expect(await addChildToCircle(db, mum, c.slug, kid, 'on', D3)).toBe('added');
    await db.query('DELETE FROM child_profiles WHERE id = $1', [kid]);
    expect((await db.query('SELECT count(*)::int AS n FROM circle_members WHERE profile_id IS NOT NULL')).rows[0].n).toBe(0);
    expect(await readSet(db, c.id, '2026-11-05', D3)).toEqual([]);
    expect(await allTime(mum, c.slug, D3)).toBe(0);
  });

  it('a closed circle with child days is purged cleanly', async () => {
    const { mum, c } = await setup();
    const kid = await childIn(db, mum, c.slug, 'Mia');
    expect(await removeChildFromCircle(db, mum, c.slug, kid, D3)).toBe(true);
    await db.query("UPDATE circles SET status = 'closed', closed_at = '2026-09-01' WHERE id = $1", [c.id]);
    const now = new Date();
    expect(await purgeClosedCircles(db, now, 100, { dbNow: async () => now })).toBe(1);
    expect((await db.query('SELECT count(*)::int AS n FROM circle_child_days')).rows[0].n).toBe(0);
  });
});
