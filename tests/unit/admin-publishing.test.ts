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

// Dates relative to today in America/New_York, matching the reporting window the endpoints enforce.
const etDay = (offset: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const REPORT = etDay(-2);
const IMPORT = etDay(-4);

async function insertItem(slug: string, title: string, world: string, createdAt: string, kind = 'article') {
  await db.query(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, created_by, risk_tier, created_at)
     VALUES ((SELECT id FROM worlds WHERE slug = $1), $5, $2, $3, 'summary', '[]'::jsonb, 'all', 'published', 'legacy-import', 'sourced', $4::timestamptz)`,
    [world, slug, title, createdAt, kind],
  );
}

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const r = await createAgent(db, 'publishing-reviewer', null, 'reviewer');
  const reviewer = (await authenticate(db, r.key))!;
  const p = await createAgent(db, 'publishing-promoter', null, 'promoter');
  const promoter = (await authenticate(db, p.key))!;

  // A reported day, with a digest post. A quiz's report slug is its content id (its library slug and public path).
  await recordReviewReport(db, reviewer, {
    date: REPORT,
    published: [
      { world: 'play', kind: 'article', title: 'How to fly a kite', slug: 'how-to-fly-a-kite' },
      { world: 'discover', kind: 'quiz', title: 'How many moons does Mars have?', slug: 'discover-quiz-mars-moons-701' },
    ],
    rejections: [{ title: 'A volcano, explained', world: 'discover', kind: 'article', reason: 'custom hero needed: volcano' }],
  });
  await recordDigestPost(db, promoter, { date: REPORT, postUrl: 'https://www.facebook.com/page/posts/123', externalId: '123' });

  // An unreported import day (15:00 UTC is the same calendar day in America/New_York). It holds one item of its
  // own and one item that a later reported batch also lists (its import landed on the earlier day).
  await insertItem('an-old-article', 'An old article', 'grow', `${IMPORT}T15:00:00Z`);
  await insertItem('how-to-fly-a-kite', 'How to fly a kite', 'play', `${IMPORT}T15:00:00Z`);
  await insertItem('discover-quiz-mars-moons-701', 'Discover quiz mars moons', 'discover', `${IMPORT}T15:00:00Z`, 'quiz');
  // A digest write alone for the import day: the day must stay an import day, with the digest shown alongside.
  await recordDigestPost(db, promoter, { date: IMPORT, postUrl: 'https://www.facebook.com/page/posts/456', externalId: '456' });
});
afterAll(async () => {
  await db.close();
});

describe('listPublishingDays', () => {
  it('shows the reported day with its items, rejection and digest link', async () => {
    const days = await listPublishingDays(db);
    const day = days.find((d) => d.date === REPORT);
    expect(day).toBeDefined();
    expect(day!.source).toBe('report');
    expect(day!.published).toEqual([
      { world: 'discover', kind: 'quiz', title: 'How many moons does Mars have?', slug: 'discover-quiz-mars-moons-701' },
      { world: 'play', kind: 'article', title: 'How to fly a kite', slug: 'how-to-fly-a-kite' },
    ]);
    expect(day!.publishedTotal).toBe(2);
    expect(day!.rejections).toHaveLength(1);
    expect(day!.rejections[0].reason).toContain('custom hero needed');
    expect(day!.digestPostUrl).toContain('facebook.com');
  });

  it('falls back to imported items for days without a report, and a digest-only row changes nothing but the link', async () => {
    const days = await listPublishingDays(db);
    const day = days.find((d) => d.date === IMPORT);
    expect(day).toBeDefined();
    expect(day!.source).toBe('import');
    // Only the day's own item: the kite article and the quiz are claimed by the reported batch (the quiz by its
    // id-as-slug), so neither is counted twice.
    expect(day!.published.map((p) => p.title)).toEqual(['An old article']);
    expect(day!.published[0].slug).toBe('an-old-article');
    expect(day!.rejections).toEqual([]);
    expect(day!.digestPostUrl).toBe('https://www.facebook.com/page/posts/456');
  });

  it('does not list a reported day twice and orders newest first', async () => {
    const days = await listPublishingDays(db);
    expect(days.filter((d) => d.date === REPORT)).toHaveLength(1);
    const dates = days.map((d) => d.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});
