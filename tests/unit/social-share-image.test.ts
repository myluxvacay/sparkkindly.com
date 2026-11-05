// @vitest-environment node
// The social share image (plan 5A Task 2): /api/template-image/<world>/<slug>/?format=social serves a 1080x1350 JPEG
// (Instagram accepts only JPEG) for an item eligible for social media, read by world and slug alone (no session, no
// personal data, publicly cacheable), and 404 for a Kids, draft or unknown item or with SOCIAL_ENABLED off.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import sharp from 'sharp';
import { newTestDb } from '../helpers/test-db';
import { socialItem } from '../helpers/social';
import { seedReference } from '@/db/seed';
import { socialShareImage } from '@/lib/social/share-image';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-05T09:00:00Z');

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  vi.stubEnv('SOCIAL_ENABLED', 'true');
});

const slugOf = async (id: string) => (await db.query<{ slug: string }>('SELECT slug FROM items WHERE id = $1', [id])).rows[0].slug;

describe('socialShareImage', () => {
  it('returns a 1080x1350 JPEG for an eligible item, publicly cacheable', async () => {
    const slug = await slugOf(await socialItem(db, { world: 'play', title: 'Spot the odd one out ☀' }));
    const res = await socialShareImage(db, 'play', slug, NOW);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toMatch(/^public/);
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 1080, height: 1350 });
  });

  it('is 404 for Kids (world, audience, tier), draft, archived and unknown items', async () => {
    for (const o of [{ world: 'kids' }, { audience: 'kids' }, { riskTier: 'kids' }, { status: 'draft' }, { status: 'archived' }]) {
      const id = await socialItem(db, o);
      const world = (o as { world?: string }).world ?? 'play';
      expect((await socialShareImage(db, world, await slugOf(id), NOW)).status, JSON.stringify(o)).toBe(404);
    }
    expect((await socialShareImage(db, 'play', 'no-such-item', NOW)).status).toBe(404);
    expect((await socialShareImage(db, '../admin', 'x', NOW)).status).toBe(404);
  });

  it('is 404 with SOCIAL_ENABLED off', async () => {
    const slug = await slugOf(await socialItem(db));
    vi.stubEnv('SOCIAL_ENABLED', '');
    expect((await socialShareImage(db, 'play', slug, NOW)).status).toBe(404);
  });
});
