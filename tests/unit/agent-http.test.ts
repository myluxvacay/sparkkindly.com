// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createAgent } from '@/lib/agents/admin';
import { createLimiter } from '@/lib/agents/rate-limit';
import { agentRoute, readJson } from '@/lib/agents/http';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let key: string;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  key = (await createAgent(db, 'http-agent', 'play')).key;
});
afterAll(async () => {
  await db.close();
});

const req = (headers: Record<string, string> = {}, init: RequestInit = {}) => new Request('https://example.test/api/agent/brief/', { headers, ...init });
const ok = async () => ({ status: 200, json: { hello: 'agent' } });

describe('agentRoute', () => {
  it('answers 401 without a key, with a malformed key, and with an unknown key', async () => {
    const limiter = createLimiter({ perMinute: 60 });
    const bad: Record<string, string>[] = [{}, { 'x-agent-key': 'junk' }, { 'x-agent-key': 'skagt_00000000_' + '0'.repeat(48) }];
    for (const headers of bad) {
      const r = await agentRoute(req(headers), ok, { db, limiter });
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('ignores an Authorization header: staging basic auth uses it, so the key never travels there', async () => {
    const r = await agentRoute(req({ authorization: `Bearer ${key}` }), ok, { db, limiter: createLimiter({ perMinute: 60 }) });
    expect(r.status).toBe(401);
    const basic = await agentRoute(req({ authorization: `Basic ${Buffer.from('user:pass').toString('base64')}`, 'x-agent-key': key }), ok, { db, limiter: createLimiter({ perMinute: 60 }) });
    expect(basic.status).toBe(200);
  });

  it('passes the authenticated agent to the handler and returns its result', async () => {
    const handler = vi.fn(async (agent: { name: string }) => ({ status: 201, json: { who: agent.name } }));
    const r = await agentRoute(req({ 'x-agent-key': key }), handler, { db, limiter: createLimiter({ perMinute: 60 }) });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ who: 'http-agent' });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 429 with Retry-After once the agent is over its limit', async () => {
    const limiter = createLimiter({ perMinute: 2 });
    const call = () => agentRoute(req({ 'x-agent-key': key }), ok, { db, limiter });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
  });

  it('turns an unexpected error into a generic 500 with no internals', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = async () => { throw new Error('connection to 10.0.0.5 refused at /opt/secret/path'); };
    const r = await agentRoute(req({ 'x-agent-key': key }), boom, { db, limiter: createLimiter({ perMinute: 60 }) });
    expect(r.status).toBe(500);
    const text = JSON.stringify(await r.json());
    expect(text).toBe('{"error":"server_error"}');
    spy.mockRestore();
  });
});

describe('readJson', () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request('https://example.test/api/agent/items/', { method: 'POST', body, headers });

  it('parses a JSON body', async () => {
    expect(await readJson(post('{"a":1}'))).toEqual({ ok: true, value: { a: 1 } });
  });
  it('answers 400 for invalid JSON and for an empty body', async () => {
    expect(await readJson(post('{not json'))).toMatchObject({ ok: false, response: expect.objectContaining({ status: 400 }) });
    expect(await readJson(post(''))).toMatchObject({ ok: false, response: expect.objectContaining({ status: 400 }) });
  });
  it('answers 413 for a body over the limit, whether declared or actual', async () => {
    const big = JSON.stringify({ x: 'a'.repeat(300_000) });
    const declared = await readJson(post('{}', { 'content-length': '300000' }));
    expect(declared).toMatchObject({ ok: false, response: expect.objectContaining({ status: 413 }) });
    const actual = await readJson(post(big));
    expect(actual).toMatchObject({ ok: false, response: expect.objectContaining({ status: 413 }) });
  });
});
