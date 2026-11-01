import { createHash } from 'node:crypto';

export type Result = { ok: boolean; status: number; data: unknown; error?: string };

export interface AgentClient {
  brief(world?: string): Promise<Result>;
  submit(item: unknown): Promise<Result>;
  status(id: string): Promise<Result>;
}

type Options = {
  baseUrl: string;
  agentKey: string;
  basicAuth?: { user: string; password: string };
  fetch?: typeof fetch;
};

const TIMEOUT_MS = 15_000;

// A small client for the SparkKindly agent API. HTTP failures come back as { ok: false } rather than being thrown,
// so a caller (Claude, through the MCP server) can read why an item was refused and fix it. The agent key is sent only
// in X-Agent-Key and is scrubbed from everything returned.
export function createClient(opts: Options): AgentClient {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');
  const scrub = <T>(value: T): T => (JSON.parse(JSON.stringify(value ?? null).split(opts.agentKey).join('[key]')) as T);

  async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Result> {
    const headers: Record<string, string> = { 'X-Agent-Key': opts.agentKey, Accept: 'application/json' };
    if (opts.basicAuth) {
      headers.Authorization = `Basic ${Buffer.from(`${opts.basicAuth.user}:${opts.basicAuth.password}`).toString('base64')}`;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const res = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Never follow a redirect: it would carry the agent key (and staging password) to wherever it points.
        redirect: 'manual',
      });
      if (res.status >= 300 && res.status < 400) {
        return { ok: false, status: res.status, data: null, error: 'The site answered with a redirect, which is not followed. Check the configured URL (it needs https and no stray path).' };
      }
      const text = await res.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = text.slice(0, 500);
      }
      const ok = res.status >= 200 && res.status < 300;
      const apiError = typeof data === 'object' && data !== null && 'error' in data ? String((data as { error: unknown }).error) : undefined;
      return scrub({ ok, status: res.status, data, error: ok ? undefined : (apiError ?? `HTTP ${res.status}`) });
    } catch (err) {
      return scrub({ ok: false, status: 0, data: null, error: `Could not reach the site: ${(err as Error).message}` });
    }
  }

  return {
    brief: (world) => request('GET', `/api/agent/brief/${world ? `?world=${encodeURIComponent(world)}` : ''}`),
    // A missing idempotencyKey is derived from the item's content: the same item retried is recognised as a replay,
    // while a corrected item (different content) is not mistaken for one.
    submit: (item) => {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const given = (item as { idempotencyKey?: unknown }).idempotencyKey;
        if (typeof given !== 'string' || !given) {
          const key = `idem-${createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 40)}`;
          return request('POST', '/api/agent/items/', { ...item, idempotencyKey: key });
        }
      }
      return request('POST', '/api/agent/items/', item);
    },
    status: (id) => request('GET', `/api/agent/items/${encodeURIComponent(id)}/`),
  };
}
