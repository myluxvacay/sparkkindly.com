// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createClient } from '@/agents/client';

const KEY = 'skagt_12345678_' + 'a'.repeat(48);
type Call = [input: string, init: RequestInit];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const stub = (res: () => Response | Promise<Response>) => vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => res());
const headersOf = (f: ReturnType<typeof stub>, i = 0) => (f.mock.calls[i][1] as RequestInit).headers as Record<string, string>;
const urlOf = (f: ReturnType<typeof stub>, i = 0) => String(f.mock.calls[i][0]);

describe('createClient', () => {
  it('sends X-Agent-Key and no Authorization header by default', async () => {
    const fetch = stub(() => json(200, { ok: 1 }));
    await createClient({ baseUrl: 'https://sparkkindly.com', agentKey: KEY, fetch }).brief();
    expect(headersOf(fetch)['X-Agent-Key']).toBe(KEY);
    expect(headersOf(fetch)).not.toHaveProperty('Authorization');
  });

  it('with basic auth sends both headers', async () => {
    const fetch = stub(() => json(200, {}));
    await createClient({ baseUrl: 'https://s', agentKey: KEY, basicAuth: { user: 'u', password: 'p' }, fetch }).brief();
    expect(headersOf(fetch).Authorization).toBe('Basic ' + Buffer.from('u:p').toString('base64'));
    expect(headersOf(fetch)['X-Agent-Key']).toBe(KEY);
  });

  it('uses the trailing-slash URLs the site requires and strips extra slashes from the base', async () => {
    const fetch = stub(() => json(200, {}));
    const c = createClient({ baseUrl: 'https://sparkkindly.com//', agentKey: KEY, fetch });
    await c.brief();
    await c.brief('play');
    await c.submit({ kind: 'quiz', slug: 's', world: 'play' });
    await c.status('0a1b2c3d-0000-4000-8000-000000000000');
    expect(fetch.mock.calls.map((c2) => String(c2[0]))).toEqual([
      'https://sparkkindly.com/api/agent/brief/',
      'https://sparkkindly.com/api/agent/brief/?world=play',
      'https://sparkkindly.com/api/agent/items/',
      'https://sparkkindly.com/api/agent/items/0a1b2c3d-0000-4000-8000-000000000000/',
    ]);
  });

  it('encodes the world in the query string', async () => {
    const fetch = stub(() => json(200, {}));
    await createClient({ baseUrl: 'https://s', agentKey: KEY, fetch }).brief('a b&c');
    expect(urlOf(fetch)).toBe('https://s/api/agent/brief/?world=a%20b%26c');
  });

  it('returns a 422 as ok:false with the body and the error code', async () => {
    const fetch = stub(() => json(422, { error: 'invalid_item', issues: [{ path: 'slug', message: 'bad' }] }));
    const r = await createClient({ baseUrl: 'https://s', agentKey: KEY, fetch }).submit({ kind: 'quiz' });
    expect(r).toMatchObject({ ok: false, status: 422, error: 'invalid_item', data: { issues: [{ path: 'slug', message: 'bad' }] } });
  });

  it('treats 200 and 201 as ok', async () => {
    const r1 = await createClient({ baseUrl: 'https://s', agentKey: KEY, fetch: stub(() => json(201, { id: 'x' })) }).submit({ kind: 'quiz' });
    expect(r1).toMatchObject({ ok: true, status: 201, data: { id: 'x' } });
  });

  it('never lets the agent key appear in an error, even if a server echoes it', async () => {
    const echo = createClient({ baseUrl: 'https://s', agentKey: KEY, fetch: stub(() => json(401, { error: `bad key ${KEY}` })) });
    const r = await echo.brief();
    expect(JSON.stringify(r)).not.toContain(KEY);
    const boom = createClient({ baseUrl: 'https://s', agentKey: KEY, fetch: stub(() => { throw new Error(`connect failed for ${KEY}`); }) });
    expect(JSON.stringify(await boom.brief())).not.toContain(KEY);
  });

  it('turns a network error into ok:false instead of throwing', async () => {
    const r = await createClient({ baseUrl: 'https://s', agentKey: KEY, fetch: stub(() => { throw new Error('ECONNRESET'); }) }).brief();
    expect(r).toMatchObject({ ok: false, status: 0 });
    expect(r.error).toMatch(/ECONNRESET/);
  });

  it('handles a non-JSON response body', async () => {
    const r = await createClient({ baseUrl: 'https://s', agentKey: KEY, fetch: stub(() => new Response('<html>Bad gateway</html>', { status: 502 })) }).brief();
    expect(r).toMatchObject({ ok: false, status: 502 });
  });

  it('puts a timeout signal on every request', async () => {
    const fetch = stub(() => json(200, {}));
    const c = createClient({ baseUrl: 'https://s', agentKey: KEY, fetch });
    await c.brief();
    await c.submit({ kind: 'quiz' });
    await c.status('0a1b2c3d-0000-4000-8000-000000000000');
    for (let i = 0; i < 3; i++) expect((fetch.mock.calls[i] as unknown as Call)[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('never follows redirects, so the key cannot be forwarded to another origin', async () => {
    const fetch = stub(() => json(200, {}));
    const c = createClient({ baseUrl: 'https://s', agentKey: KEY, fetch });
    await c.brief();
    await c.submit({ kind: 'quiz' });
    await c.status('0a1b2c3d-0000-4000-8000-000000000000');
    for (let i = 0; i < 3; i++) expect((fetch.mock.calls[i][1] as RequestInit).redirect).toBe('manual');
  });

  it('reports a redirect as a failure instead of following it', async () => {
    const fetch = stub(() => new Response(null, { status: 308, headers: { location: 'https://elsewhere.example/api/agent/brief/' } }));
    const r = await createClient({ baseUrl: 'https://s', agentKey: KEY, fetch }).brief();
    expect(r).toMatchObject({ ok: false, status: 308 });
    expect(r.error).toMatch(/redirect/i);
    expect(JSON.stringify(r)).not.toContain('elsewhere.example');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends the item as JSON with the right method and content type', async () => {
    const fetch = stub(() => json(201, {}));
    await createClient({ baseUrl: 'https://s', agentKey: KEY, fetch }).submit({ kind: 'quiz', slug: 'abc' });
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(headersOf(fetch)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toMatchObject({ kind: 'quiz', slug: 'abc' });
  });
});

describe('submit idempotency key', () => {
  const sent = async (item: unknown) => {
    const fetch = stub(() => json(201, {}));
    await createClient({ baseUrl: 'https://s', agentKey: KEY, fetch }).submit(item);
    return JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string) as { idempotencyKey?: string };
  };

  it('adds a deterministic key when missing, so a retry cannot duplicate', async () => {
    const item = { kind: 'quiz', slug: 'same', world: 'play', title: 'T' };
    const a = await sent(item);
    const b = await sent({ ...item });
    expect(a.idempotencyKey).toMatch(/^idem-[0-9a-f]{40}$/);
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });

  it('changes the key when the content changes, so a corrected item is not mistaken for a replay', async () => {
    const first = await sent({ kind: 'quiz', slug: 'fixme', title: 'Wrong' });
    const fixed = await sent({ kind: 'quiz', slug: 'fixme', title: 'Right' });
    expect(first.idempotencyKey).not.toBe(fixed.idempotencyKey);
  });

  it('keeps a key the caller supplied', async () => {
    expect((await sent({ kind: 'quiz', slug: 's', idempotencyKey: 'my-own-key-123' })).idempotencyKey).toBe('my-own-key-123');
  });

  it('passes a non-object straight through for the server to reject', async () => {
    const fetch = stub(() => json(422, { error: 'invalid_item' }));
    const r = await createClient({ baseUrl: 'https://s', agentKey: KEY, fetch }).submit('not an object');
    expect(r.status).toBe(422);
    expect((fetch.mock.calls[0][1] as RequestInit).body).toBe('"not an object"');
  });
});

describe('timeout', () => {
  it('outlasts the server source-check budget, so a slow but successful submit is not reported as unreachable', async () => {
    const { SOURCE_BUDGET_MS } = await import('@/lib/items/gates');
    const { CLIENT_TIMEOUT_MS } = await import('@/agents/client');
    expect(CLIENT_TIMEOUT_MS).toBeGreaterThanOrEqual(SOURCE_BUDGET_MS + 15_000);
  });

  it('says the item may have been stored when the request times out', async () => {
    const r = await createClient({ baseUrl: 'https://s', agentKey: KEY, fetch: stub(() => { throw new DOMException('timed out', 'TimeoutError'); }) }).submit({ kind: 'quiz' });
    expect(r.error).toMatch(/may have been (stored|saved)/i);
  });
});
