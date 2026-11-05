// @vitest-environment node
// The moderation agent API over HTTP (plan 7B Task 2): role separation, refusals that carry no data, the 4 KB cap,
// the flags, and the queue/decide round trip through the same functions the routes call.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { comment, item, person, setLevel, statusOf } from '../helpers/comments';
import { seedReference } from '@/db/seed';
import { createAgent } from '@/lib/agents/admin';
import { authenticate } from '@/lib/agents/auth';
import { agentRoute } from '@/lib/agents/http';
import { createLimiter } from '@/lib/agents/rate-limit';
import { decideRequest, queueRequest } from '@/lib/comments/moderation-api';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let modKey: string;
let contentKey: string;
const NOW = new Date('2026-11-05T12:00:00Z');
const env = { UNSUBSCRIBE_SECRET: 'unit-test-only-appeal-secret-0123456789' };

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  modKey = (await createAgent(db, 'moderator', null, 'moderation')).key;
  contentKey = (await createAgent(db, 'master', null)).key;
});
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('COMMENTS_ENABLED', 'true');
});

const deps = () => ({ db, now: NOW, env, send: vi.fn(async () => ({})), limiter: createLimiter({ perMinute: 60 }) });
const get = (key: string) => new Request('https://s.example.test/api/agent/moderation/', { headers: { 'x-agent-key': key } });
const post = (key: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://s.example.test/api/agent/moderation/decide/', {
    method: 'POST',
    headers: { 'x-agent-key': key, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('agent roles', () => {
  it('authenticate carries the role; createAgent refuses a moderation agent tied to a world', async () => {
    expect((await authenticate(db, modKey))?.role).toBe('moderation');
    expect((await authenticate(db, contentKey))?.role).toBe('content');
    await expect(createAgent(db, 'mod-play', 'play', 'moderation')).rejects.toThrow();
  });

  it('a content key is refused on moderation routes, with no data', async () => {
    for (const r of [await queueRequest(get(contentKey), deps()), await decideRequest(post(contentKey, {}), deps())]) {
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: 'forbidden_role' });
    }
  });

  it('a moderation key is refused on content routes (the default role)', async () => {
    const r = await agentRoute(get(modKey), async () => ({ status: 200, json: { brief: 'secret' } }), { db, limiter: createLimiter({ perMinute: 60 }) });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'forbidden_role' });
  });

  it('missing, disabled and rotated keys get 401 with no data', async () => {
    const { key } = await createAgent(db, 'moderator-2', null, 'moderation');
    await db.query("UPDATE agents SET enabled = false WHERE name = 'moderator-2'");
    for (const k of ['', key, 'skagt_00000000_' + '0'.repeat(48)]) {
      const r = await queueRequest(get(k), deps());
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('with the comment flags off both routes are 404', async () => {
    vi.stubEnv('COMMENTS_ENABLED', '');
    expect((await queueRequest(get(modKey), deps())).status).toBe(404);
    expect((await decideRequest(post(modKey, {}), deps())).status).toBe(404);
  });
});

describe('queue and decide over HTTP', () => {
  it('round trip: the queue lists a held comment, decide approves it', async () => {
    const author = await person(db, NOW);
    await setLevel(db, author.id, 0);
    const id = await comment(db, await item(db), author.id, 'hello there', 'held');
    const q = await queueRequest(get(modKey), deps());
    expect(q.status).toBe(200);
    expect(q.headers.get('cache-control')).toBe('no-store');
    const body = (await q.json()) as { comments: { id: string; version: string }[] };
    const entry = body.comments.find((c) => c.id === id)!;
    const r = await decideRequest(post(modKey, { id, decision: 'approve', version: entry.version }), deps());
    expect(r.status).toBe(200);
    expect(await statusOf(db, id)).toBe('published');
  });

  it('refuses a body over 4 KB and invalid JSON', async () => {
    expect((await decideRequest(post(modKey, { id: 'x', reason: 'y'.repeat(5000) }), deps())).status).toBe(413);
    expect((await decideRequest(post(modKey, '{not json'), deps())).status).toBe(400);
  });

  it('is rate limited', async () => {
    const d = { ...deps(), limiter: () => false };
    expect((await queueRequest(get(modKey), d)).status).toBe(429);
  });
});
