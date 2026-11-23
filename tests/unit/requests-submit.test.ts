// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { createRequestLimits, submitPrintableRequest, visitorHash } from '@/lib/requests/submit';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const HASH = 'c'.repeat(64);
const ok = { category: 'printables-fold-make', age: 'ages-5-8', text: 'A paper boat that really floats', website: '' };
const count = async () => Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM printable_requests')).rows[0].n);

beforeAll(async () => { db = await newTestDb(); });
afterAll(async () => { await db.close(); });

describe('submitPrintableRequest', () => {
  it('stores a valid request as pending, with no personal data anywhere in the row', async () => {
    expect(await submitPrintableRequest(db, ok, HASH)).toEqual({ status: 'stored' });
    const r = await db.query<Record<string, unknown>>('SELECT * FROM printable_requests');
    expect(r.rows).toHaveLength(1);
    expect(Object.keys(r.rows[0]).sort()).toEqual([
      'age_topic', 'category_topic', 'created_at', 'created_url', 'id', 'me_too_count',
      'request_text', 'reviewed_at', 'status', 'submitter_hash', 'updated_at',
    ]);
    expect(r.rows[0]).toMatchObject({ request_text: 'A paper boat that really floats', status: 'pending' });
  });

  it('drops a honeypot submission while answering as if stored', async () => {
    expect(await submitPrintableRequest(db, { ...ok, website: 'http://spam.example' }, HASH)).toEqual({ status: 'dropped' });
    expect(await count()).toBe(1);
  });

  it('rejects unknown categories and age bands, markup, and over-length text', async () => {
    expect(await submitPrintableRequest(db, { ...ok, category: 'not-a-category' }, HASH)).toEqual({ status: 'invalid' });
    expect(await submitPrintableRequest(db, { ...ok, category: 'printables-how-things-work' }, HASH)).toEqual({ status: 'stored' });
    expect(await submitPrintableRequest(db, { ...ok, age: 'ages-3-5' }, HASH)).toEqual({ status: 'invalid' });
    expect(await submitPrintableRequest(db, { ...ok, text: 'a <b>bold</b> sheet' }, HASH)).toEqual({ status: 'invalid' });
    expect(await submitPrintableRequest(db, { ...ok, text: 'x'.repeat(281) }, HASH)).toEqual({ status: 'invalid' });
    expect(await submitPrintableRequest(db, { ...ok, text: 'ab' }, HASH)).toEqual({ status: 'invalid' });
    expect(await count()).toBe(2);
  });

  it('visitorHash is a stable one-way hash of the client prefix', () => {
    expect(visitorHash('203.0.113.7')).toMatch(/^[0-9a-f]{64}$/);
    expect(visitorHash('203.0.113.7')).toBe(visitorHash('203.0.113.7'));
    expect(visitorHash('203.0.113.7')).not.toBe(visitorHash('198.51.100.9'));
    expect(visitorHash('203.0.113.7', 'ua')).not.toBe(visitorHash('203.0.113.7'));
  });

  it('rate limits: the sixth submission in an hour from one client is refused', () => {
    let t = 1_700_000_000_000;
    const limits = createRequestLimits(() => t);
    for (let i = 0; i < 5; i++) expect(limits.submit('client-a').ok).toBe(true);
    expect(limits.submit('client-a').ok).toBe(false);
    expect(limits.submit('client-b').ok).toBe(true);
    t += 61 * 60_000;
    expect(limits.submit('client-a').ok).toBe(true);
  });
});
