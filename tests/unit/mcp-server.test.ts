// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '@/agents/mcp/server';
import type { AgentClient, Result } from '@/agents/client';

const FORMAT_DOC = '# SparkKindly item format\nExample text.';
const open: Client[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

function fakeClient(over: Partial<AgentClient> = {}): AgentClient & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = { brief: [], submit: [], status: [] };
  const ok = (data: unknown, status = 200): Result => ({ ok: true, status, data });
  return {
    calls,
    brief: vi.fn(async (...a: unknown[]) => { calls.brief.push(a); return ok({ world: { slug: 'play' } }); }),
    submit: vi.fn(async (...a: unknown[]) => { calls.submit.push(a); return ok({ id: 'item-1', status: 'scheduled' }, 201); }),
    status: vi.fn(async (...a: unknown[]) => { calls.status.push(a); return ok({ id: a[0], status: 'published' }); }),
    ...over,
  } as never;
}

async function connect(deps: Parameters<typeof buildServer>[0]) {
  const server = buildServer(deps);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(b);
  open.push(client);
  return client;
}
const textOf = (r: unknown) => (r as { content: { type: string; text: string }[] }).content[0].text;

describe('SparkKindly MCP server', () => {
  it('lists exactly the four tools', async () => {
    const c = await connect({ client: fakeClient(), formatDoc: FORMAT_DOC });
    const tools = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['sparkkindly_brief', 'sparkkindly_item_format', 'sparkkindly_item_status', 'sparkkindly_submit_item']);
  });

  it('every tool has a description that tells Claude when to use it', async () => {
    const c = await connect({ client: fakeClient(), formatDoc: FORMAT_DOC });
    for (const t of (await c.listTools()).tools) expect((t.description ?? '').length, t.name).toBeGreaterThan(40);
  });

  it('sparkkindly_item_format returns the format document', async () => {
    const c = await connect({ client: fakeClient(), formatDoc: FORMAT_DOC });
    expect(textOf(await c.callTool({ name: 'sparkkindly_item_format', arguments: {} }))).toBe(FORMAT_DOC);
  });

  it('sparkkindly_submit_item passes the item to the API and returns the result as text', async () => {
    const fake = fakeClient();
    const c = await connect({ client: fake, formatDoc: FORMAT_DOC });
    const item = { kind: 'quiz', slug: 'a-slug' };
    const r = await c.callTool({ name: 'sparkkindly_submit_item', arguments: { item } });
    expect(fake.calls.submit[0]).toEqual([item]);
    expect(JSON.parse(textOf(r))).toEqual({ ok: true, status: 201, data: { id: 'item-1', status: 'scheduled' } });
    expect(r.isError).toBeFalsy();
  });

  it('an API rejection comes back as a readable result, not a crash', async () => {
    const rejecting = fakeClient({ submit: vi.fn(async () => ({ ok: false, status: 422, data: { issues: [{ path: 'slug', message: 'bad' }] }, error: 'invalid_item' })) });
    const c = await connect({ client: rejecting, formatDoc: FORMAT_DOC });
    const r = await c.callTool({ name: 'sparkkindly_submit_item', arguments: { item: { kind: 'quiz' } } });
    expect(JSON.parse(textOf(r))).toMatchObject({ ok: false, status: 422, error: 'invalid_item' });
  });

  it('sparkkindly_brief passes the optional world', async () => {
    const fake = fakeClient();
    const c = await connect({ client: fake, formatDoc: FORMAT_DOC });
    await c.callTool({ name: 'sparkkindly_brief', arguments: {} });
    await c.callTool({ name: 'sparkkindly_brief', arguments: { world: 'grow' } });
    expect(fake.calls.brief).toEqual([[undefined], ['grow']]);
  });

  it('sparkkindly_item_status passes the id', async () => {
    const fake = fakeClient();
    const c = await connect({ client: fake, formatDoc: FORMAT_DOC });
    const r = await c.callTool({ name: 'sparkkindly_item_status', arguments: { id: '0a1b2c3d-0000-4000-8000-000000000000' } });
    expect(fake.calls.status[0]).toEqual(['0a1b2c3d-0000-4000-8000-000000000000']);
    expect(JSON.parse(textOf(r)).data.status).toBe('published');
  });

  it('rejects a submit with no item or a non-object item before touching the API', async () => {
    const fake = fakeClient();
    const c = await connect({ client: fake, formatDoc: FORMAT_DOC });
    for (const args of [{}, { item: 'text' }, { item: 5 }]) {
      const r = await c.callTool({ name: 'sparkkindly_submit_item', arguments: args }).catch((e: Error) => ({ isError: true, content: [{ type: 'text', text: e.message }] }));
      expect(r.isError, JSON.stringify(args)).toBe(true);
    }
    expect(fake.calls.submit).toHaveLength(0);
  });

  it('an unconfigured server names the missing settings and nothing else, and still lists its tools', async () => {
    const c = await connect({ client: null, missing: ['SPARKKINDLY_STAGING_URL', 'SPARKKINDLY_STAGING_AGENT_KEY'], secretsHint: 'your secrets file', formatDoc: FORMAT_DOC });
    expect((await c.listTools()).tools).toHaveLength(4);
    const r = await c.callTool({ name: 'sparkkindly_brief', arguments: {} });
    const out = JSON.parse(textOf(r));
    expect(out).toMatchObject({ ok: false, status: 0 });
    expect(out.error).toMatch(/SPARKKINDLY_STAGING_URL/);
    expect(out.error).toMatch(/SPARKKINDLY_STAGING_AGENT_KEY/);
    expect(out.error).toMatch(/your secrets file/);
    // the format document needs no configuration
    expect(textOf(await c.callTool({ name: 'sparkkindly_item_format', arguments: {} }))).toBe(FORMAT_DOC);
  });

  it('a thrown error inside a tool is reported without leaking internals', async () => {
    const throwing = fakeClient({ brief: vi.fn(async () => { throw new Error('secret internal detail at /opt/x'); }) });
    const c = await connect({ client: throwing, formatDoc: FORMAT_DOC });
    const r = await c.callTool({ name: 'sparkkindly_brief', arguments: {} });
    expect(JSON.parse(textOf(r))).toMatchObject({ ok: false });
    expect(textOf(r)).not.toContain('/opt/x');
  });
});
