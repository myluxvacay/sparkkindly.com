// @vitest-environment node
// Unpublishing and social distributions (plan 5A Task 3): when an item is archived (transitionTx, so every unpublish
// path: admin, contributor withdrawal, account deletion), its pending distributions are cancelled and its posted ones
// flagged for manual removal with one alert each, in the same transaction as the item change.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { distribution, socialItem, statusOf } from '../helpers/social';
import { seedReference } from '@/db/seed';
import { transition } from '@/lib/items/repo';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM failed_jobs');
});

describe('archiving an item', () => {
  it('cancels selected, copy_ready and scheduled rows, flags posted ones, leaves the rest; one alert per flagged row', async () => {
    const item = await socialItem(db);
    const other = await socialItem(db);
    const ids = {
      instagram: await distribution(db, item, 'instagram', { status: 'scheduled', caption: 'x' }),
      facebook: await distribution(db, item, 'facebook', { status: 'posted', caption: 'x', postedAt: '2026-11-04T12:00:00Z' }),
      tiktok: await distribution(db, item, 'tiktok', { status: 'selected' }),
      youtube: await distribution(db, item, 'youtube', { status: 'failed', caption: 'x' }),
      untouched: await distribution(db, other, 'instagram', { status: 'scheduled', caption: 'x' }),
    };
    await db.query("UPDATE distributions SET status = 'copy_ready' WHERE id = $1", [ids.tiktok]);
    await transition(db, item, 'archived', 'owner@example.test', 'unpublished');
    expect(await statusOf(db, ids.instagram)).toBe('cancelled');
    expect(await statusOf(db, ids.tiktok)).toBe('cancelled');
    expect(await statusOf(db, ids.facebook)).toBe('flagged');
    expect(await statusOf(db, ids.youtube)).toBe('failed');
    expect(await statusOf(db, ids.untouched)).toBe('scheduled');
    const flagged = (await db.query<{ last_error: string }>('SELECT last_error FROM distributions WHERE id = $1', [ids.facebook])).rows[0];
    expect(flagged.last_error).toMatch(/remove manually/i);
    const alerts = (await db.query<{ job: string }>('SELECT job FROM failed_jobs')).rows;
    expect(alerts).toEqual([{ job: 'social-post' }]);
  });

  it('5A review L2: a row in posting is flagged with an alert (the platform may be publishing it)', async () => {
    const item = await socialItem(db);
    const id = await distribution(db, item, 'instagram', { status: 'posting', caption: 'x' });
    await transition(db, item, 'archived', 'owner@example.test', 'unpublished');
    expect(await statusOf(db, id)).toBe('flagged');
    expect((await db.query<{ job: string }>('SELECT job FROM failed_jobs')).rows).toEqual([{ job: 'social-post' }]);
  });

  it('is part of the item transaction: a failed transition changes no distribution', async () => {
    const item = await socialItem(db, { status: 'draft' });
    const id = await distribution(db, item, 'instagram', { status: 'selected' });
    await expect(
      db.transaction(async (tx) => {
        const { transitionTx } = await import('@/lib/items/repo');
        await transitionTx(tx, item, 'archived', 'owner', 'x');
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(await statusOf(db, id)).toBe('selected');
  });

  it('other transitions leave distributions alone', async () => {
    const item = await socialItem(db, { status: 'scheduled', publishedAt: '2026-11-06T00:00:00Z' });
    const id = await distribution(db, item, 'instagram', { status: 'selected' });
    await transition(db, item, 'published', 'system');
    expect(await statusOf(db, id)).toBe('selected');
  });
});
