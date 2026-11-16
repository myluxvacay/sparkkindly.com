// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createAgent } from '@/lib/agents/admin';
import { authenticate } from '@/lib/agents/auth';
import { recordReviewReport, recordDigestPost } from '@/lib/agents/publishing';
import { listPublishingDays } from '@/lib/admin/publishing';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;

async function insertItem(slug: string, title: string, world: string, createdAt: string) {
  await db.query(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, created_by, risk_tier, created_at)
     VALUES ((SELECT id FROM worlds WHERE slug = $1), 'article', $2, $3, 'summary', '[]'::jsonb, 'all', 'published', 'legacy-import', 'sourced', $4::timestamptz)`,
    [world, slug, title, createdAt],
  );
}

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const r = await createAgent(db, 'publishing-reviewer', null, 'reviewer');
  const reviewer = (await authenticate(db, r.key))!;
  const p = await createAgent(db, 'publishing-promoter', null, 'promoter');
  const promoter = (await authenticate(db, p.key))!;

  // A reported day: 2026-11-14, with a digest post.
  await recordReviewReport(db, reviewer, {
    date: '2026-11-14',
    published: [{ world: 'play', kind: 'article', title: 'How to fly a kite', slug: 'how-to-fly-a-kite' }],
    rejections: [{ title: 'A volcano, explained', world: 'discover', kind: 'article', reason: 'custom hero needed: volcano' }],
  });
  await recordDigestPost(db, promoter, { date: '2026-11-14', postUrl: 'https://www.facebook.com/page/posts/123', externalId: '123' });

  // An unreported import day: 2026-11-12 (15:00 UTC = 10:00 in America/New_York).
  await insertItem('an-old-article', 'An old article', 'grow', '2026-11-12T15:00:00Z');
  // An item imported on the reported day itself must not duplicate the report day as an import day.
  await insertItem('how-to-fly-a-kite', 'How to fly a kite', 'play', '2026-11-14T15:00:00Z');
});
afterAll(async () => {
  await db.close();
});

describe('listPublishingDays', () => {
  it('shows the reported day with its items, rejection and digest link', async () => {
    const days = await listPublishingDays(db);
    const day = days.find((d) => d.date === '2026-11-14');
    expect(day).toBeDefined();
    expect(day!.source).toBe('report');
    expect(day!.published).toEqual([{ world: 'play', kind: 'article', title: 'How to fly a kite', slug: 'how-to-fly-a-kite' }]);
    expect(day!.publishedTotal).toBe(1);
    expect(day!.rejections).toHaveLength(1);
    expect(day!.rejections[0].reason).toContain('custom hero needed');
    expect(day!.digestPostUrl).toContain('facebook.com');
  });

  it('falls back to imported items for days before reports existed', async () => {
    const days = await listPublishingDays(db);
    const day = days.find((d) => d.date === '2026-11-12');
    expect(day).toBeDefined();
    expect(day!.source).toBe('import');
    expect(day!.published.map((p) => p.title)).toEqual(['An old article']);
    expect(day!.published[0].slug).toBe('an-old-article');
    expect(day!.rejections).toEqual([]);
    expect(day!.digestPostUrl).toBeNull();
  });

  it('does not list a reported day twice and orders newest first', async () => {
    const days = await listPublishingDays(db);
    expect(days.filter((d) => d.date === '2026-11-14')).toHaveLength(1);
    const dates = days.map((d) => d.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});
