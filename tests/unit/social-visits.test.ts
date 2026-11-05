// @vitest-environment node
// Private counting of social landings (plan 5A Task 3): an item page visit whose utm_source is one of the four platform
// names adds one to an aggregate (day, platform, item) row. Nothing else is stored: no cookie, IP or identifier. Any
// other value, a repeated parameter, or SOCIAL_ENABLED off writes nothing; a database error never reaches the page.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { newTestDb } from '../helpers/test-db';
import { socialItem } from '../helpers/social';
import { seedReference } from '@/db/seed';
import { recordSocialVisit } from '@/lib/social/visits';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-05T12:00:00Z');

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  vi.stubEnv('SOCIAL_ENABLED', 'true');
  await db.query('DELETE FROM social_visits');
});

const visits = async () =>
  (await db.query<{ day: string; platform: string; visits: number }>("SELECT to_char(day, 'YYYY-MM-DD') AS day, platform, visits FROM social_visits ORDER BY platform")).rows;

// 5A review L7: only items that were posted on that platform are counted.
async function postedItem(platforms = ['instagram', 'facebook']) {
  const item = await socialItem(db);
  for (const p of platforms) {
    await db.query("INSERT INTO distributions (item_id, platform, day, status, posted_at) VALUES ($1, $2, '2026-11-04', 'posted', '2026-11-04T12:00:00Z')", [item, p]);
  }
  return item;
}

describe('recordSocialVisit', () => {
  it('5A review L7: an item never posted on that platform is not counted', async () => {
    const item = await postedItem(['facebook']);
    await recordSocialVisit(db, item, 'instagram', NOW);
    await recordSocialVisit(db, await socialItem(db), 'facebook', NOW);
    expect(await visits()).toEqual([]);
  });

  it('counts a valid utm_source per day, platform and item', async () => {
    const item = await postedItem();
    await recordSocialVisit(db, item, 'instagram', NOW);
    await recordSocialVisit(db, item, 'instagram', NOW);
    await recordSocialVisit(db, item, 'facebook', NOW);
    expect(await visits()).toEqual([
      { day: '2026-11-05', platform: 'facebook', visits: 1 },
      { day: '2026-11-05', platform: 'instagram', visits: 2 },
    ]);
  });

  it('ignores any other value, a repeated parameter and a missing one', async () => {
    const item = await postedItem();
    for (const v of ['twitter', 'Instagram', 'instagram ', '', undefined, ['instagram', 'facebook'], "instagram'; DROP TABLE items"]) {
      await recordSocialVisit(db, item, v as never, NOW);
    }
    expect(await visits()).toEqual([]);
  });

  it('with SOCIAL_ENABLED off it touches nothing', async () => {
    const item = await socialItem(db);
    vi.stubEnv('SOCIAL_ENABLED', '');
    const spy = vi.spyOn(db, 'query');
    await recordSocialVisit(db, item, 'instagram', NOW);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('never throws to the page', async () => {
    const broken = { query: async () => { throw new Error('db down'); } } as never;
    await expect(recordSocialVisit(broken, 'x', 'instagram', NOW)).resolves.toBeUndefined();
  });

  it('the table holds no identifier columns', async () => {
    const cols = (await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'social_visits' ORDER BY column_name")).rows.map((r) => r.column_name);
    expect(cols).toEqual(['day', 'item_id', 'platform', 'visits']);
  });

  it('the item page calls it with the utm_source parameter only, after the item is found', () => {
    const page = readFileSync('app/[world]/[slug]/page.tsx', 'utf8');
    expect(page).toMatch(/recordSocialVisit\(db, item\.id, \(await searchParams\)\.utm_source, new Date\(\)\)/);
  });
});
