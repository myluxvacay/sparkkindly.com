// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createAgent } from '@/lib/agents/admin';
import { authenticate, type Agent } from '@/lib/agents/auth';
import { recordRun, latestRun } from '@/lib/agents/runs';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let master: Agent;
let play: Agent;
const NOW = new Date('2026-11-02T12:00:00Z');

async function agentFor(name: string, world: string | null): Promise<Agent> {
  const { key } = await createAgent(db, name, world);
  return (await authenticate(db, key))!;
}

const run = (over: Record<string, unknown> = {}) => ({
  worlds: ['play', 'discover'],
  itemsSubmitted: 3,
  itemsScheduled: 2,
  itemsInReview: 1,
  itemsRejected: 1,
  rateLimited: false,
  ...over,
});

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  master = await agentFor('master', null);
  play = await agentFor('play-agent', 'play');
});
afterAll(async () => {
  await db.close();
});

describe('recordRun', () => {
  it('stores a run from the master agent and reports it as the latest', async () => {
    expect(await latestRun(db)).toBeNull();
    const r = await recordRun(db, master, run(), NOW);
    expect(r.status).toBe(200);
    const stored = await db.query<{ n: string; rate_limited: boolean }>('SELECT count(*) AS n, bool_or(rate_limited) AS rate_limited FROM agent_runs');
    expect(Number(stored.rows[0].n)).toBe(1);
    expect(stored.rows[0].rate_limited).toBe(false);
    expect((await latestRun(db))!.endedAt.toISOString()).toBe(NOW.toISOString());
  });

  it("stamps the time itself: an agent has no clock, so a time it sends is ignored", async () => {
    const later = new Date('2026-11-02T13:00:00Z');
    await recordRun(db, master, run({ startedAt: '2020-01-01T00:00:00Z', endedAt: '2030-01-01T00:00:00Z' }), later);
    expect((await latestRun(db))!.endedAt.toISOString()).toBe(later.toISOString());
  });

  it('keeps the rate-limited flag', async () => {
    await recordRun(db, master, run({ rateLimited: true, note: 'Pro limit reached after play' }), NOW);
    const r = await db.query<{ rate_limited: boolean }>('SELECT rate_limited FROM agent_runs ORDER BY id DESC LIMIT 1');
    expect(r.rows[0].rate_limited).toBe(true);
  });

  it('refuses a world agent: only the master records runs', async () => {
    const r = await recordRun(db, play, run(), NOW);
    expect(r.status).toBe(403);
  });

  it.each([
    ['an unknown world', { worlds: ['no-such-world'] }],
    ['no worlds', { worlds: [] }],
    ['a negative count', { itemsRejected: -1 }],
    ['a note over 300 characters', { note: 'x'.repeat(301) }],
  ])('refuses %s', async (_name, over) => {
    const before = await db.query<{ n: string }>('SELECT count(*) AS n FROM agent_runs');
    const r = await recordRun(db, master, run(over), NOW);
    expect(r.status).toBe(400);
    const after = await db.query<{ n: string }>('SELECT count(*) AS n FROM agent_runs');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
