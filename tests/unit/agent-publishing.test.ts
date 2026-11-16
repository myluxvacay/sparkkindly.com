// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createAgent } from '@/lib/agents/admin';
import { authenticate, type Agent } from '@/lib/agents/auth';
import { recordReviewReport, recordDigestPost } from '@/lib/agents/publishing';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let reviewer: Agent;
let promoter: Agent;

// Batch dates are relative to today in America/New_York, matching the reporting window the endpoints enforce.
const etDay = (offset: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const D1 = etDay(-1);
const D2 = etDay(-2);
const D3 = etDay(-3);
const D4 = etDay(-4);

const report = (over: Record<string, unknown> = {}) => ({
  date: D2,
  published: [
    { world: 'play', kind: 'article', title: 'How to fly a kite', slug: 'how-to-fly-a-kite' },
    { world: 'discover', kind: 'quiz', title: 'How many moons does Mars have?', slug: null },
  ],
  rejections: [{ title: 'A volcano, explained', world: 'discover', kind: 'article', reason: 'custom hero needed: volcano' }],
  ...over,
});

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const r = await createAgent(db, 'publishing-reviewer', null, 'reviewer');
  reviewer = (await authenticate(db, r.key))!;
  const p = await createAgent(db, 'publishing-promoter', null, 'promoter');
  promoter = (await authenticate(db, p.key))!;
});
afterAll(async () => {
  await db.close();
});

describe('recordReviewReport', () => {
  it('stores the batch, its published items and its rejections', async () => {
    const r = await recordReviewReport(db, reviewer, report());
    expect(r.status).toBe(200);
    const items = await db.query<{ n: string }>('SELECT count(*) AS n FROM publishing_items WHERE batch_date = $1::date', [D2]);
    const rejections = await db.query<{ reason: string }>('SELECT reason FROM publishing_rejections WHERE batch_date = $1::date', [D2]);
    expect(Number(items.rows[0].n)).toBe(2);
    expect(rejections.rows).toHaveLength(1);
    expect(rejections.rows[0].reason).toContain('custom hero needed');
  });

  it('is idempotent per date: a retry replaces the lists instead of duplicating them', async () => {
    const retry = report({ published: [{ world: 'grow', kind: 'article', title: 'Teach it to learn it twice', slug: 'teach-it' }], rejections: [] });
    const r = await recordReviewReport(db, reviewer, retry);
    expect(r.status).toBe(200);
    const items = await db.query<{ title: string }>('SELECT title FROM publishing_items WHERE batch_date = $1::date', [D2]);
    const rejections = await db.query<{ n: string }>('SELECT count(*) AS n FROM publishing_rejections WHERE batch_date = $1::date', [D2]);
    expect(items.rows.map((x) => x.title)).toEqual(['Teach it to learn it twice']);
    expect(Number(rejections.rows[0].n)).toBe(0);
  });

  it('rejects a bad date, an out-of-window date, an unknown world and a missing reason', async () => {
    expect((await recordReviewReport(db, reviewer, report({ date: '2026-02-30' }))).status).toBe(400);
    expect((await recordReviewReport(db, reviewer, report({ date: '2999-01-01' }))).status).toBe(400);
    expect((await recordReviewReport(db, reviewer, report({ date: '2020-01-01' }))).status).toBe(400);
    expect((await recordReviewReport(db, reviewer, report({ published: [{ world: 'atlantis', kind: 'article', title: 'X', slug: 'x' }] }))).status).toBe(400);
    expect((await recordReviewReport(db, reviewer, report({ rejections: [{ title: 'X', world: 'play', kind: 'article' }] }))).status).toBe(400);
  });

  it('stores a duplicated entry in one report only once', async () => {
    const entry = { world: 'play', kind: 'article', title: 'How to fly a kite', slug: 'how-to-fly-a-kite' };
    const r = await recordReviewReport(db, reviewer, report({ date: D1, published: [entry, entry], rejections: [] }));
    expect(r.status).toBe(200);
    const items = await db.query<{ n: string }>('SELECT count(*) AS n FROM publishing_items WHERE batch_date = $1::date', [D1]);
    expect(Number(items.rows[0].n)).toBe(1);
  });
});

describe('recordDigestPost', () => {
  it('sets only the digest fields and survives a later review report for the same date', async () => {
    const d = await recordDigestPost(db, promoter, { date: D2, postUrl: 'https://www.facebook.com/61592978620272/posts/123', externalId: '123' });
    expect(d.status).toBe(200);
    await recordReviewReport(db, reviewer, report());
    const batch = await db.query<{ digest_post_url: string; digest_external_id: string }>(
      'SELECT digest_post_url, digest_external_id FROM publishing_batches WHERE batch_date = $1::date',
      [D2],
    );
    expect(batch.rows[0].digest_post_url).toContain('facebook.com');
    expect(batch.rows[0].digest_external_id).toBe('123');
    const items = await db.query<{ n: string }>('SELECT count(*) AS n FROM publishing_items WHERE batch_date = $1::date', [D2]);
    expect(Number(items.rows[0].n)).toBe(2);
  });

  it('creates the batch row when the digest lands first, and requires a URL or an id', async () => {
    const d = await recordDigestPost(db, promoter, { date: D3, externalId: '999' });
    expect(d.status).toBe(200);
    const batch = await db.query<{ digest_external_id: string }>('SELECT digest_external_id FROM publishing_batches WHERE batch_date = $1::date', [D3]);
    expect(batch.rows[0].digest_external_id).toBe('999');
    expect((await recordDigestPost(db, promoter, { date: D3 })).status).toBe(400);
    expect((await recordDigestPost(db, promoter, { date: D3, postUrl: 'http://example.com/x' })).status).toBe(400);
  });

  it('accepts only Facebook https URLs, without credentials', async () => {
    expect((await recordDigestPost(db, promoter, { date: D3, postUrl: 'https://evil.example.com/login' })).status).toBe(400);
    expect((await recordDigestPost(db, promoter, { date: D3, postUrl: 'https://user:pass@www.facebook.com/x' })).status).toBe(400);
    expect((await recordDigestPost(db, promoter, { date: D3, postUrl: 'https://facebook.com.evil.example/x' })).status).toBe(400);
    expect((await recordDigestPost(db, promoter, { date: D3, postUrl: 'https://fb.watch/abc123' })).status).toBe(200);
    expect((await recordDigestPost(db, promoter, { date: D3, postUrl: 'https://www.facebook.com/page/posts/1' })).status).toBe(200);
  });

  it('replaces the digest fields as a whole, so a repost cannot leave a mismatched URL/id pair', async () => {
    await recordDigestPost(db, promoter, { date: D4, postUrl: 'https://www.facebook.com/page/posts/111', externalId: '111' });
    await recordDigestPost(db, promoter, { date: D4, externalId: '222' });
    const batch = await db.query<{ digest_post_url: string | null; digest_external_id: string }>(
      'SELECT digest_post_url, digest_external_id FROM publishing_batches WHERE batch_date = $1::date',
      [D4],
    );
    expect(batch.rows[0].digest_post_url).toBeNull();
    expect(batch.rows[0].digest_external_id).toBe('222');
  });
});
