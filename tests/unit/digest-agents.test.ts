// @vitest-environment node
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createAgent } from '@/lib/agents/admin';
import { createItem, type NewItem } from '@/lib/items/repo';
import { buildDigest } from '@/lib/admin/digest';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let masterId: number;
const ids: Record<string, number> = {};
let n = 0;
const NOW = new Date('2026-11-10T08:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  for (const w of (await db.query<{ id: number; slug: string }>('SELECT id, slug FROM worlds')).rows) ids[w.slug] = w.id;
  await createAgent(db, 'master', null);
  masterId = (await db.query<{ id: number }>("SELECT id FROM agents WHERE name = 'master'")).rows[0].id;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM agent_runs');
  await db.query('DELETE FROM items');
  await db.query('UPDATE worlds SET buffer_days = 0');
});

const run = (endedHoursAgo: number, worlds: string[], over: { rateLimited?: boolean; startedDaysAgo?: number } = {}) =>
  db.query(
    `INSERT INTO agent_runs (agent_id, worlds, started_at, ended_at, items_submitted, items_scheduled, items_in_review, items_rejected, rate_limited)
     VALUES ($1, $2, $3, $4, 1, 1, 0, 0, $5)`,
    [masterId, worlds, over.startedDaysAgo ? hoursAgo(over.startedDaysAgo * 24).toISOString() : hoursAgo(endedHoursAgo + 0.2).toISOString(), hoursAgo(endedHoursAgo).toISOString(), over.rateLimited ?? false],
  );

const item = async (world: string, over: Partial<NewItem> = {}, createdHoursAgo = 2) => {
  const it = await createItem(db, {
    worldId: ids[world], kind: 'article', slug: `da-${++n}`, title: `Title ${n}`, summary: 'A summary', body: {},
    audience: 'all', createdBy: 'test', riskTier: 'reflective', status: 'scheduled', publishAt: daysFromNow(1), approvedBy: 'x', ...over,
  });
  await db.query('UPDATE items SET created_at = $2 WHERE id = $1', [it.id, hoursAgo(createdHoursAgo).toISOString()]);
  return it;
};

const alerts = async () => (await buildDigest(db, NOW)).alerts.join('\n');

describe('shortfall', () => {
  it('names a world a recent run covered that produced no new item that passed', async () => {
    await run(2, ['play', 'discover']);
    await item('play');
    await item('discover', { status: 'draft', publishAt: undefined, approvedBy: undefined });
    const a = await alerts();
    expect(a).toMatch(/discover: no new item passed review/);
    expect(a).not.toMatch(/play: no new item/);
  });

  it('says nothing when no run has been recorded', async () => {
    expect(await alerts()).not.toMatch(/no new item passed review/);
  });

  it('ignores a world the run did not cover', async () => {
    await run(2, ['play']);
    await item('play');
    expect(await alerts()).not.toMatch(/grow: no new item/);
  });
});

describe('rate limit', () => {
  it('counts runs that hit the plan limit in the last 24 hours', async () => {
    await run(3, ['play'], { rateLimited: true });
    await run(6, ['grow'], { rateLimited: true });
    await run(30, ['kids'], { rateLimited: true });
    await run(4, ['together'], { rateLimited: false });
    expect(await alerts()).toMatch(/limit was hit in 2 runs/);
  });

  it('is silent when no run hit it', async () => {
    await run(3, ['play']);
    expect(await alerts()).not.toMatch(/limit was hit/);
  });
});

describe('upgrade advice', () => {
  beforeEach(async () => {
    await db.query("UPDATE worlds SET buffer_days = 1 WHERE slug = 'play'");
    await run(2, ['play'], { startedDaysAgo: 9 });
  });
  // An item created `createdDaysAgo` days ago and due tomorrow is "ahead" on every day from then until now.
  const aheadSince = (createdDaysAgo: number) => item('play', { publishAt: daysFromNow(1) }, createdDaysAgo * 24);

  it('recommends a higher plan when a world missed its buffer target on 3 of the last 7 days', async () => {
    await aheadSince(4.5);
    expect(await alerts()).toMatch(/play missed its buffer target on 3 of the last 7 days.*raising the Claude plan/s);
  });

  it('does not when it missed on only 2 of 7', async () => {
    await aheadSince(5.5);
    expect(await alerts()).not.toMatch(/raising the Claude plan/);
  });

  it('does not when there is less than 7 days of run history to judge by', async () => {
    await db.query('DELETE FROM agent_runs');
    await run(2, ['play'], { startedDaysAgo: 3 });
    expect(await alerts()).not.toMatch(/raising the Claude plan/);
  });
});
