// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { anonymousScope } from '@/lib/public/scope';
import { submitReport, createReportLimits } from '@/lib/reports/submit';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const scope = anonymousScope(new Date('2026-11-01T12:00:00Z'));
const ok = { world: 'play', slug: 'live', reason: 'wrong', message: 'The answer looks off.', website: '' };
const count = async () => Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM problem_reports')).rows[0].n);

async function put(slug: string, status: string, kind = 'article') {
  const w = await db.query<{ id: number }>("SELECT id FROM worlds WHERE slug = 'play'");
  await db.query(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     VALUES ($1,$2,$3,'T','S','{}'::jsonb,'all',$4,'2026-10-31T00:00:00Z','test','computable','test')`,
    [w.rows[0].id, kind, slug, status],
  );
}

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  await put('live', 'published');
  await put('drafty', 'draft');
  await put('script', 'published', 'video_script');
});
afterAll(async () => {
  await db.close();
});

describe('submitReport', () => {
  it('stores a report for a published item, with no reporter identity', async () => {
    expect(await submitReport(db, scope, ok)).toEqual({ status: 'stored' });
    const r = await db.query<Record<string, unknown>>('SELECT * FROM problem_reports');
    expect(r.rows).toHaveLength(1);
    expect(Object.keys(r.rows[0]).sort()).toEqual(['created_at', 'id', 'item_id', 'message', 'reason', 'status']);
    expect(r.rows[0]).toMatchObject({ reason: 'wrong', message: 'The answer looks off.', status: 'open' });
  });

  it('is not_found, and writes nothing, for an unknown slug, a draft and a video_script', async () => {
    const before = await count();
    for (const slug of ['nope', 'drafty', 'script']) {
      expect(await submitReport(db, scope, { ...ok, slug })).toEqual({ status: 'not_found' });
    }
    expect(await submitReport(db, scope, { ...ok, world: 'nope' })).toEqual({ status: 'not_found' });
    expect(await count()).toBe(before);
  });

  it('is not_found for an item outside the scope audience', async () => {
    const before = await count();
    expect(await submitReport(db, { ...scope, audiences: [] }, ok)).toEqual({ status: 'not_found' });
    expect(await count()).toBe(before);
  });

  it('rejects a bad reason, a non-string message and a 1001-character message; accepts 1000', async () => {
    const before = await count();
    expect(await submitReport(db, scope, { ...ok, reason: 'spam' })).toEqual({ status: 'invalid' });
    expect(await submitReport(db, scope, { ...ok, reason: undefined })).toEqual({ status: 'invalid' });
    expect(await submitReport(db, scope, { ...ok, message: 42 })).toEqual({ status: 'invalid' });
    expect(await submitReport(db, scope, { ...ok, message: 'x'.repeat(1001) })).toEqual({ status: 'invalid' });
    expect(await count()).toBe(before);
    expect(await submitReport(db, scope, { ...ok, message: ` ${'x'.repeat(1000)} ` })).toEqual({ status: 'stored' });
  });

  it('pretends success but writes nothing when the honeypot is filled', async () => {
    const before = await count();
    expect(await submitReport(db, scope, { ...ok, website: 'http://spam.example' })).toEqual({ status: 'stored' });
    expect(await count()).toBe(before);
  });

  it('stores markup verbatim', async () => {
    const message = '<script>alert(1)</script> & "quotes"';
    await submitReport(db, scope, { ...ok, reason: 'other', message });
    const r = await db.query<{ message: string }>("SELECT message FROM problem_reports WHERE reason = 'other'");
    expect(r.rows[0].message).toBe(message);
  });
});

describe('report rate limits', () => {
  it('refuses the sixth report from one client in an hour; another client still succeeds', () => {
    let t = 0;
    const check = createReportLimits(() => t);
    for (let i = 0; i < 5; i++) expect(check('1.1.1.1').ok).toBe(true);
    const sixth = check('1.1.1.1');
    expect(sixth.ok).toBe(false);
    expect(sixth.ok === false && sixth.retryAfter).toBeGreaterThan(0);
    expect(check('2.2.2.2').ok).toBe(true);
    t += 61 * 60_000;
    expect(check('1.1.1.1').ok).toBe(true);
  });

  it('applies a global limit of 200 an hour across clients', () => {
    const check = createReportLimits(() => 0);
    for (let i = 0; i < 200; i++) expect(check(`c${i}`).ok).toBe(true);
    expect(check('fresh').ok).toBe(false);
  });
});
