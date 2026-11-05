// @vitest-environment node
// Hold-everything (spec 4a.6, 7B go-live item): when no enabled moderation agent has fetched its queue in the last 48
// hours, new comments from level-1 accounts are held like everyone else's. Plus the digest's escalation-overdue alert.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { item, person, setLevel } from '../helpers/comments';
import { seedReference } from '@/db/seed';
import { createAgent } from '@/lib/agents/admin';
import { createLimiter } from '@/lib/agents/rate-limit';
import { postComment } from '@/lib/comments/repo';
import { decideRequest, queueRequest } from '@/lib/comments/moderation-api';
import { agentRoute } from '@/lib/agents/http';
import { moderationActive } from '@/lib/comments/hold';
import { commentCounts } from '@/lib/comments/counts';
import { buildDigest, renderDigest } from '@/lib/admin/digest';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-05T12:00:00Z');
const H = 3_600_000;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('COMMENTS_ENABLED', 'true');
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM items');
  await db.query('DELETE FROM agents');
  await db.query('DELETE FROM audit_log');
});

async function levelOnePost(now = NOW) {
  const p = await person(db, now);
  await setLevel(db, p.id, 1);
  return postComment(db, p.ctx, { itemId: await item(db), body: 'a level one comment' }, now);
}
const lastRun = (at: Date | null, enabled = true) =>
  db.query("UPDATE agents SET queue_fetched_at = $1, enabled = $2 WHERE role = 'moderation'", [at, enabled]);

describe('hold-everything', () => {
  it('no moderation agent at all: level-1 comments are held', async () => {
    expect(await moderationActive(db, NOW)).toBe(false);
    expect((await levelOnePost()).status).toBe('held');
  });

  it('an agent that fetched within 48 hours: published; exactly 48 hours ago still counts; a moment more does not', async () => {
    await createAgent(db, 'moderator', null, 'moderation');
    await lastRun(new Date(NOW.getTime() - 47 * H));
    expect((await levelOnePost()).status).toBe('published');
    await lastRun(new Date(NOW.getTime() - 48 * H));
    expect(await moderationActive(db, NOW)).toBe(true);
    expect((await levelOnePost()).status).toBe('published');
    await lastRun(new Date(NOW.getTime() - 48 * H - 1000));
    expect(await moderationActive(db, NOW)).toBe(false);
    expect((await levelOnePost()).status).toBe('held');
  });

  it('a disabled agent or a content agent does not count', async () => {
    await createAgent(db, 'moderator', null, 'moderation');
    await lastRun(NOW, false);
    expect((await levelOnePost()).status).toBe('held');
    const { id } = await createAgent(db, 'master', null);
    await db.query('UPDATE agents SET queue_fetched_at = $2 WHERE id = $1', [id, NOW]);
    expect(await moderationActive(db, NOW)).toBe(false);
  });

  it('only a queue fetch is the heartbeat: a recent sign of life, a decide call or a refused call does not count', async () => {
    const { key } = await createAgent(db, 'moderator', null, 'moderation');
    await db.query("UPDATE agents SET queue_fetched_at = $1, last_run_at = $2 WHERE role = 'moderation'", [new Date(NOW.getTime() - 72 * H), NOW]);
    expect(await moderationActive(db, NOW)).toBe(false);
    const deps = { db, now: NOW, env: {}, send: async () => ({}), limiter: createLimiter({ perMinute: 60 }) };
    const decide = new Request('https://s.example.test/api/agent/moderation/decide/', {
      method: 'POST',
      headers: { 'x-agent-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'x', version: '1', decision: 'approve' }),
    });
    await decideRequest(decide, deps);
    const denied = await agentRoute(new Request('https://s.example.test/api/agent/brief/', { headers: { 'x-agent-key': key } }), async () => ({ status: 200, json: {} }), { db, limiter: deps.limiter });
    expect(denied.status).toBe(403);
    expect(await moderationActive(db, NOW)).toBe(false);
    expect((await levelOnePost()).status).toBe('held');
  });

  it('a queue fetch by the moderation agent records the time, which re-opens instant publishing', async () => {
    const { key } = await createAgent(db, 'moderator', null, 'moderation');
    await lastRun(new Date(NOW.getTime() - 72 * H));
    expect((await levelOnePost()).status).toBe('held');
    const r = await queueRequest(new Request('https://s.example.test/api/agent/moderation/', { headers: { 'x-agent-key': key } }), {
      db,
      now: NOW,
      env: {},
      send: async () => ({}),
      limiter: createLimiter({ perMinute: 60 }),
    });
    expect(r.status).toBe(200);
    expect(await moderationActive(db, NOW)).toBe(true);
    expect((await levelOnePost()).status).toBe('published');
  });
});

describe('digest', () => {
  it('counts escalations waiting past 48 hours and agent keeps, and raises an alert line (counts only)', async () => {
    const author = await person(db, NOW);
    const it = await item(db);
    await db.query(
      `INSERT INTO comments (item_id, account_id, body, status, escalated_at) VALUES
         ($1, $2, 'old secret words', 'held', $3), ($1, $2, 'new words', 'held', $4)`,
      [it, author.id, new Date(NOW.getTime() - 49 * H), new Date(NOW.getTime() - H)],
    );
    await db.query("INSERT INTO audit_log (actor, action, target, at) VALUES ('agent:moderator', 'comment.keep', 'comment:x', $1)", [NOW]);
    const c = await commentCounts(db, NOW);
    expect(c).toMatchObject({ escalated: 2, escalatedOverdue: 1, keptByAgent: 1, publishedByAgent: 0 });
    const { text } = renderDigest(await buildDigest(db, NOW));
    expect(text).toMatch(/1 comment escalation is waiting past the 48-hour target/);
    expect(text).toMatch(/Kept by the agent in the last 24 hours \(reported comments restored\): 1/);
    expect(text).not.toContain('old secret words');
  });
});
