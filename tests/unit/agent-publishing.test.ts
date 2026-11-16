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

const report = (over: Record<string, unknown> = {}) => ({
  date: '2026-11-14',
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
    const items = await db.query<{ n: string }>('SELECT count(*) AS n FROM publishing_items WHERE batch_date = $1::date', ['2026-11-14']);
    const rejections = await db.query<{ reason: string }>('SELECT reason FROM publishing_rejections WHERE batch_date = $1::date', ['2026-11-14']);
    expect(Number(items.rows[0].n)).toBe(2);
    expect(rejections.rows).toHaveLength(1);
    expect(rejections.rows[0].reason).toContain('custom hero needed');
  });

  it('is idempotent per date: a retry replaces the lists instead of duplicating them', async () => {
    const retry = report({ published: [{ world: 'grow', kind: 'article', title: 'Teach it to learn it twice', slug: 'teach-it' }], rejections: [] });
    const r = await recordReviewReport(db, reviewer, retry);
    expect(r.status).toBe(200);
    const items = await db.query<{ title: string }>('SELECT title FROM publishing_items WHERE batch_date = $1::date', ['2026-11-14']);
    const rejections = await db.query<{ n: string }>('SELECT count(*) AS n FROM publishing_rejections WHERE batch_date = $1::date', ['2026-11-14']);
    expect(items.rows.map((x) => x.title)).toEqual(['Teach it to learn it twice']);
    expect(Number(rejections.rows[0].n)).toBe(0);
  });

  it('rejects a bad date, a future date, an unknown world and a missing reason', async () => {
    expect((await recordReviewReport(db, reviewer, report({ date: '2026-02-30' }))).status).toBe(400);
    expect((await recordReviewReport(db, reviewer, report({ date: '2999-01-01' }))).status).toBe(400);
    expect((await recordReviewReport(db, reviewer, report({ published: [{ world: 'atlantis', kind: 'article', title: 'X', slug: 'x' }] }))).status).toBe(400);
    expect((await recordReviewReport(db, reviewer, report({ rejections: [{ title: 'X', world: 'play', kind: 'article' }] }))).status).toBe(400);
  });
});

describe('recordDigestPost', () => {
  it('sets only the digest fields and survives a later review report for the same date', async () => {
    const d = await recordDigestPost(db, promoter, { date: '2026-11-14', postUrl: 'https://www.facebook.com/61592978620272/posts/123', externalId: '123' });
    expect(d.status).toBe(200);
    await recordReviewReport(db, reviewer, report());
    const batch = await db.query<{ digest_post_url: string; digest_external_id: string }>(
      'SELECT digest_post_url, digest_external_id FROM publishing_batches WHERE batch_date = $1::date',
      ['2026-11-14'],
    );
    expect(batch.rows[0].digest_post_url).toContain('facebook.com');
    expect(batch.rows[0].digest_external_id).toBe('123');
    const items = await db.query<{ n: string }>('SELECT count(*) AS n FROM publishing_items WHERE batch_date = $1::date', ['2026-11-14']);
    expect(Number(items.rows[0].n)).toBe(2);
  });

  it('creates the batch row when the digest lands first, and requires a URL or an id', async () => {
    const d = await recordDigestPost(db, promoter, { date: '2026-11-13', externalId: '999' });
    expect(d.status).toBe(200);
    const batch = await db.query<{ digest_external_id: string }>('SELECT digest_external_id FROM publishing_batches WHERE batch_date = $1::date', ['2026-11-13']);
    expect(batch.rows[0].digest_external_id).toBe('999');
    expect((await recordDigestPost(db, promoter, { date: '2026-11-13' })).status).toBe(400);
    expect((await recordDigestPost(db, promoter, { date: '2026-11-13', postUrl: 'http://example.com/x' })).status).toBe(400);
  });
});
