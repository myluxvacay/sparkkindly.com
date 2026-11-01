// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createItem, type NewItem } from '@/lib/items/repo';
import { createAgent } from '@/lib/agents/admin';
import { listQueue, listItems, getItemDetail, listReports, listAgents } from '@/lib/admin/queries';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let playId: number;
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  playId = (await db.query<{ id: number }>("SELECT id FROM worlds WHERE slug = 'play'")).rows[0].id;
});
afterAll(async () => {
  await db.close();
});

const make = (over: Partial<NewItem> = {}) =>
  createItem(db, {
    worldId: playId, kind: 'article', slug: `q-${++n}`, title: `Title ${n}`, summary: 'A summary', body: {},
    audience: 'all', createdBy: 'test', riskTier: 'reflective', ...over,
  });

describe('admin queries', () => {
  it('the queue holds only in_review items', async () => {
    const waiting = await make({ status: 'in_review', title: 'Waiting one' });
    await make({ status: 'draft' });
    const q = await listQueue(db);
    expect(q.map((i) => i.id)).toEqual([waiting.id]);
  });

  it('items filter by status and title, ignore an unknown status, and treat LIKE wildcards literally', async () => {
    await make({ status: 'draft', title: '100% sure' });
    await make({ status: 'draft', title: 'Other' });
    expect((await listItems(db, { status: 'draft' })).every((i) => i.status === 'draft')).toBe(true);
    expect((await listItems(db, { q: '%' })).map((i) => i.title)).toEqual(['100% sure']);
    expect((await listItems(db, { status: "draft' OR 1=1 --" })).length).toBeGreaterThan(1);
  });

  it('item detail has revisions and reports; a malformed id is null', async () => {
    const item = await make({ status: 'draft' });
    await db.query("INSERT INTO problem_reports (item_id, reason, message) VALUES ($1, 'wrong', '<b>x</b>')", [item.id]);
    const d = await getItemDetail(db, item.id);
    expect(d?.revisions).toHaveLength(1);
    expect(d?.reports[0].message).toBe('<b>x</b>');
    expect(await getItemDetail(db, 'nope')).toBeNull();
  });

  it('open reports carry the item and its quality report', async () => {
    const r = await listReports(db);
    expect(r[0]).toMatchObject({ reason: 'wrong', world: 'play' });
    expect(r[0]).toHaveProperty('qualityReport');
  });

  it('agents never expose a key hash', async () => {
    await createAgent(db, 'q-agent', 'play');
    const a = await listAgents(db);
    expect(JSON.stringify(a)).not.toMatch(/key_hash|[0-9a-f]{64}/);
    expect(a[0]).toMatchObject({ name: 'q-agent', world: 'play', enabled: true });
  });
});
