import type { Queryable } from '@/lib/db';
import { authenticate, type Agent } from './auth';
import type { ApiResult } from './api';
import { createLimiter } from './rate-limit';

const MAX_BODY_BYTES = 200_000;
const headers = { 'cache-control': 'no-store' };
const reply = (status: number, json: unknown, extra: Record<string, string> = {}) => Response.json(json, { status, headers: { ...headers, ...extra } });

// One limiter for the process, shared by all three routes even if the bundler gives each route its own module copy.
const shared = globalThis as unknown as { __sparkAgentLimiter?: ReturnType<typeof createLimiter> };
export const agentLimiter = (shared.__sparkAgentLimiter ??= createLimiter({ perMinute: 60 }));

// Runs one agent API request: authenticate by the X-Agent-Key header (an Authorization header is ignored, because
// staging's basic auth uses it), apply the per-agent limit, run the handler, and never let an internal error out.
export async function agentRoute(
  request: Request,
  handler: (agent: Agent) => Promise<ApiResult>,
  deps: { db: Queryable; limiter: (key: string) => boolean },
): Promise<Response> {
  try {
    const agent = await authenticate(deps.db, request.headers.get('x-agent-key'));
    if (!agent) return reply(401, { error: 'unauthorized' });
    if (!deps.limiter(String(agent.id))) return reply(429, { error: 'rate_limited' }, { 'retry-after': '60' });
    const result = await handler(agent);
    return reply(result.status, result.json);
  } catch (err) {
    console.error('agent api error:', (err as Error).message);
    return reply(500, { error: 'server_error' });
  }
}

// Reads the body chunk by chunk and gives up the moment the running total passes the cap, so a client that streams
// without a Content-Length cannot make the server buffer an unbounded body before the size check.
async function readCapped(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return all;
}

export async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, response: reply(413, { error: 'body_too_large' }) };
  const bytes = await readCapped(request);
  if (!bytes) return { ok: false, response: reply(413, { error: 'body_too_large' }) };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, response: reply(400, { error: 'invalid_json' }) };
  }
}
