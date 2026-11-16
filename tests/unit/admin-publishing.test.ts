// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createAgent } from '@/lib/agents/admin';
import { authenticate } from '@/lib/agents/auth';
import { recordReviewReport, recordDigestPost } from '@/lib/agents/publishing';
import { listPublishingGrid, resolvePublishingWindow, etToday } from '@/lib/admin/publishing';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;

// Dates relative to today in America/New_York, matching the reporting window the endpoints enforce.
const etDay = (offset: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const REPORT = etDay(-2); // reported day inside the default 7-day window
const IMPORT = etDay(-4); // import day inside the default window
const OLD_REPORT = etDay(-10); // reported day outside the default window, inside 30 days
const OLD_IMPORT = etDay(-12); // import day outside the default window

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

  // An older reported day and an older import day, both outside the default window.
  await recordReviewReport(db, reviewer, {
    date: OLD_REPORT,
    published: [{ world: 'grow', kind: 'article', title: 'An older batch article', slug: 'an-older-batch-article' }],
    rejections: [{ title: 'A shaky savings claim', world: 'save', kind: 'article', reason: 'source does not support the claim' }],
  });
  await insertItem('a-very-old-article', 'A very old article', 'together', `${OLD_IMPORT}T15:00:00Z`);
});
afterAll(async () => {
  await db.close();
});

describe('resolvePublishingWindow', () => {
  it('defaults to the last 7 days in America/New_York', () => {
    const { range, window } = resolvePublishingWindow({}, etToday());
    expect(range).toBe('7');
    expect(window.to).toBe(etToday());
    expect(window.from).toBe(etDay(-6));
  });

  it('supports 30 days, all, and a custom span (swapped when reversed)', () => {
    expect(resolvePublishingWindow({ range: '30' }, etToday()).window.from).toBe(etDay(-29));
    expect(resolvePublishingWindow({ range: 'all' }).window).toEqual({ from: null, to: null });
    expect(resolvePublishingWindow({ range: 'custom', from: etDay(-2), to: etDay(-9) }).window).toEqual({
      from: etDay(-9),
      to: etDay(-2),
    });
    expect(resolvePublishingWindow({ range: 'custom', from: 'not-a-date' }).window).toEqual({ from: null, to: null });
  });
});

describe('listPublishingGrid', () => {
  it('loads only the last 7 days by default, as rows with the reported day first', async () => {
    const grid = await listPublishingGrid(db);
    expect(grid.range).toBe('7');
    expect(grid.total).toBe(4);
    expect(grid.publishedCount).toBe(3);
    expect(grid.heldCount).toBe(1);
    expect(grid.rows.map((r) => r.date)).toEqual([REPORT, REPORT, REPORT, IMPORT]);
    expect(grid.rows.map((r) => r.title)).not.toContain('An older batch article');
    expect(grid.rows.map((r) => r.title)).not.toContain('A very old article');
    const quiz = grid.rows.find((r) => r.kind === 'quiz');
    expect(quiz).toMatchObject({ world: 'discover', slug: 'discover-quiz-mars-moons-701', status: 'published', reason: null });
    const held = grid.rows.find((r) => r.status === 'held');
    expect(held).toMatchObject({ title: 'A volcano, explained', world: 'discover', slug: null });
    expect(held!.reason).toContain('custom hero needed');
  });

  it('carries the digest link and source per day present in the rows', async () => {
    const grid = await listPublishingGrid(db);
    const report = grid.days.find((d) => d.date === REPORT);
    expect(report).toMatchObject({ source: 'report', digestPostUrl: 'https://www.facebook.com/page/posts/123', digestExternalId: '123' });
    // A digest write alone does not turn the import day into a reported day; the digest still shows alongside.
    const imp = grid.days.find((d) => d.date === IMPORT);
    expect(imp).toMatchObject({ source: 'import', digestPostUrl: 'https://www.facebook.com/page/posts/456' });
  });

  it('falls back to imported items for days without a report, without double-listing claimed items', async () => {
    const grid = await listPublishingGrid(db);
    const impRows = grid.rows.filter((r) => r.date === IMPORT);
    // Only the day's own item: the kite article and the quiz are claimed by the reported batch (the quiz by its
    // id-as-slug), so neither is counted twice.
    expect(impRows.map((r) => r.title)).toEqual(['An old article']);
    expect(impRows[0]).toMatchObject({ slug: 'an-old-article', status: 'published' });
  });

  it('pulls older batches on demand with the 30-day range, keeping the same semantics', async () => {
    const grid = await listPublishingGrid(db, { range: '30' });
    expect(grid.total).toBe(7);
    expect(grid.heldCount).toBe(2);
    const dates = grid.rows.map((r) => r.date);
    expect(dates).toEqual([...dates].sort().reverse());
    const old = grid.rows.filter((r) => r.date === OLD_REPORT);
    expect(old.map((r) => r.status)).toEqual(['published', 'held']);
    expect(grid.rows.find((r) => r.date === OLD_IMPORT)?.title).toBe('A very old article');
    expect(grid.days.find((d) => d.date === OLD_REPORT)).toMatchObject({ source: 'report', digestPostUrl: null });
  });

  it('pulls an older day exactly with a custom range', async () => {
    const grid = await listPublishingGrid(db, { range: 'custom', from: OLD_REPORT, to: OLD_REPORT });
    expect(grid.total).toBe(2);
    expect(grid.rows.map((r) => r.date)).toEqual([OLD_REPORT, OLD_REPORT]);
  });

  it('filters by world, type, status and title text', async () => {
    expect((await listPublishingGrid(db, { world: 'play' })).rows.map((r) => r.title)).toEqual(['How to fly a kite']);
    expect((await listPublishingGrid(db, { kind: 'quiz' })).rows.map((r) => r.title)).toEqual(['How many moons does Mars have?']);
    const held = await listPublishingGrid(db, { status: 'held' });
    expect(held.rows.map((r) => r.title)).toEqual(['A volcano, explained']);
    expect(held.days.map((d) => d.date)).toEqual([REPORT]);
    expect((await listPublishingGrid(db, { q: 'KITE' })).rows.map((r) => r.title)).toEqual(['How to fly a kite']);
    expect((await listPublishingGrid(db, { q: 'no such title' })).total).toBe(0);
    // An unrecognized filter value is ignored, as on the Items page, rather than erroring.
    expect((await listPublishingGrid(db, { world: 'nope' })).total).toBe(4);
  });
});
