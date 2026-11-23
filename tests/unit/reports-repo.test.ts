// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { countReportsByStatus, listReportsByStatus, setReportStatus } from '@/lib/reports/repo';
import { submitReport } from '@/lib/reports/submit';
import { anonymousScope } from '@/lib/public/scope';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const scope = anonymousScope(new Date('2026-11-23T12:00:00Z'));

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const w = await db.query<{ id: number }>("SELECT id FROM worlds WHERE slug = 'play'");
  await db.query(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     VALUES ($1,'article','live','T','S','{}'::jsonb,'all','published','2026-10-31T00:00:00Z','test','computable','test')`,
    [w.rows[0].id],
  );
});
afterAll(async () => { await db.close(); });

describe('mistake reports lifecycle', () => {
  it('a report lands as pending, accepts the new issue types, and lists in the queue with its item', async () => {
    expect(await submitReport(db, scope, { world: 'play', slug: 'live', reason: 'typo', message: 'Teh cat sat.', website: '' })).toEqual({ status: 'stored' });
    expect(await submitReport(db, scope, { world: 'play', slug: 'live', reason: 'picture', message: 'Picture shows a dog.', website: '' })).toEqual({ status: 'stored' });
    const pending = await listReportsByStatus(db, 'pending');
    expect(pending).toHaveLength(2);
    expect(pending[0]).toMatchObject({ itemSlug: 'live', itemTitle: 'T', world: 'play', status: 'pending' });
    expect((await countReportsByStatus(db)).pending).toBe(2);
  });

  it('decisions move a report once; a second decision is refused', async () => {
    const [first] = await listReportsByStatus(db, 'pending');
    expect(await setReportStatus(db, first.id, 'pending', 'fixed')).toBe(true);
    expect(await setReportStatus(db, first.id, 'pending', 'duplicate')).toBe(false);
    expect((await countReportsByStatus(db)).fixed).toBe(1);
    const [second] = await listReportsByStatus(db, 'pending');
    expect(await setReportStatus(db, second.id, 'pending', 'not-a-mistake')).toBe(true);
  });
});
