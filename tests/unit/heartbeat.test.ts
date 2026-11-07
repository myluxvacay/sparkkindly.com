// @vitest-environment node
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createAgent } from '@/lib/agents/admin';
import { claimHeartbeat, deliverHeartbeat } from '@/lib/jobs/heartbeat';
import { tick } from '@/worker/main';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let masterId: number;
const env = { ADMIN_EMAILS: 'owner@example.test, second@example.test' };
const NOW = new Date('2026-11-02T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

async function runEndedAt(iso: string) {
  await db.query(
    `INSERT INTO agent_runs (agent_id, worlds, started_at, ended_at, items_submitted, items_scheduled, items_in_review, items_rejected)
     VALUES ($1, ARRAY['play'], $2::timestamptz - interval '10 minutes', $2, 1, 1, 0, 0)`,
    [masterId, iso],
  );
}

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM agent_runs');
  await db.query('DELETE FROM job_runs');
  await db.query('DELETE FROM failed_jobs');
  await db.query('DELETE FROM agents');
  await createAgent(db, 'master', null);
  masterId = (await db.query<{ id: number }>("SELECT id FROM agents WHERE name = 'master'")).rows[0].id;
});

describe('claimHeartbeat', () => {
  it('is quiet on a fresh install: no run has ever been recorded', async () => {
    expect(await claimHeartbeat(db, NOW, env)).toEqual({ status: 'quiet' });
  });

  it('is ok when the last run ended 35 hours ago', async () => {
    await runEndedAt(hoursAgo(35));
    expect(await claimHeartbeat(db, NOW, env)).toEqual({ status: 'ok' });
  });

  it('claims an alert when the last run ended 37 hours ago, once per day', async () => {
    await runEndedAt(hoursAgo(37));
    const first = await claimHeartbeat(db, NOW, env);
    expect(first).toMatchObject({ status: 'claimed', day: '2026-11-02', to: ['owner@example.test', 'second@example.test'] });
    expect(await claimHeartbeat(db, new Date(NOW.getTime() + 60_000), env)).toEqual({ status: 'quiet' });
    const tomorrow = new Date(NOW.getTime() + 24 * 3_600_000);
    expect(await claimHeartbeat(db, tomorrow, env)).toMatchObject({ status: 'claimed', day: '2026-11-03' });
  });

  it('is quiet when the master agent is disabled', async () => {
    await runEndedAt(hoursAgo(80));
    await db.query("UPDATE agents SET enabled = false WHERE name = 'master'");
    expect(await claimHeartbeat(db, NOW, env)).toEqual({ status: 'quiet' });
  });

  it('a disabled content master with an enabled moderation agent is quiet: only a content agent is a master', async () => {
    await runEndedAt(hoursAgo(80));
    await db.query("UPDATE agents SET enabled = false WHERE name = 'master'");
    await createAgent(db, 'moderator', null, 'moderation');
    await createAgent(db, 'promoter', null, 'promoter');
    expect(await claimHeartbeat(db, NOW, env)).toEqual({ status: 'quiet' });
  });

  it('an active moderation or promoter agent does not hide a silent content master', async () => {
    await runEndedAt(hoursAgo(80));
    await createAgent(db, 'moderator', null, 'moderation');
    await createAgent(db, 'promoter', null, 'promoter');
    await db.query("UPDATE agents SET last_run_at = $1 WHERE role <> 'content'", [hoursAgo(1)]);
    expect(await claimHeartbeat(db, NOW, env)).toMatchObject({ status: 'claimed' });
  });

  it('is quiet with nobody on the allow-list, and does not use up the day', async () => {
    await runEndedAt(hoursAgo(80));
    expect(await claimHeartbeat(db, NOW, {})).toEqual({ status: 'quiet' });
    expect(await claimHeartbeat(db, NOW, env)).toMatchObject({ status: 'claimed' });
  });
});

describe('deliverHeartbeat', () => {
  it('names the hours of silence and sends to each address once, even when retried', async () => {
    const send = vi.fn(async (m: { to: string }) => {
      if (m.to === 'second@example.test' && send.mock.calls.length === 2) throw new Error('mail down');
    });
    const to = ['owner@example.test', 'second@example.test'];
    const deliver = () => deliverHeartbeat(db, NOW, '2026-11-02', to, new Date(hoursAgo(40)), send);
    await expect(deliver()).rejects.toThrow(/1 address/);
    await deliver();
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(['owner@example.test', 'second@example.test', 'second@example.test']);
    expect(send.mock.calls[0][0]).toMatchObject({ subject: expect.stringMatching(/agents/i), text: expect.stringMatching(/40 hours/) });
  });
});

describe('worker tick', () => {
  it('sends one heartbeat alert after 36 hours of silence and not again that day', async () => {
    await runEndedAt(hoursAgo(50));
    const send = vi.fn(async () => undefined);
    const first = await tick(db, NOW, { ...env, DIGEST_HOUR_UTC: '23' }, send, { delayMs: 0 });
    expect(first.join(';')).toMatch(/heartbeat: attempted for 2/);
    const sent = send.mock.calls.length;
    const second = await tick(db, new Date(NOW.getTime() + 60_000), { ...env, DIGEST_HOUR_UTC: '23' }, send, { delayMs: 0 });
    expect(second.join(';')).toMatch(/heartbeat: quiet/);
    expect(send.mock.calls.length).toBe(sent);
  });
});
