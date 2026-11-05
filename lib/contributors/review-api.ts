// The two contribution routes for the reviewer pass (plan 8) as plain functions of a Request, so they test without Next:
// the flags (404 when off), then agentRoute with the content role (a moderation key gets 403, a missing, disabled or
// rotated key 401), then the master check (a world agent's key gets 403), the shared per-agent limiter and an 8 KB body
// cap on verdicts. No Next.js imports. Verified by tests/unit/contributors-review-api.test.ts.
import type { Agent } from '@/lib/agents/auth';
import type { ApiResult } from '@/lib/agents/api';
import { agentRoute, readJson } from '@/lib/agents/http';
import { contributorsEnabled } from '@/lib/config';
import type { Db } from '@/lib/db';
import { contributionQueue, recordVerdict, type VerdictDeps } from './review';

export type ReviewDeps = VerdictDeps & { db: Db; now: Date; limiter: (key: string) => boolean };

const MAX_VERDICT_BYTES = 8_192;
const notFound = () => Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
const masterOnly = (agent: Agent): ApiResult | null => (agent.worldId === null ? null : { status: 403, json: { error: 'forbidden_agent' } });

// GET /api/agent/contributions/: up to 5 contributions waiting for the reviewer.
export function queueRequest(request: Request, d: ReviewDeps): Promise<Response> {
  if (!contributorsEnabled()) return Promise.resolve(notFound());
  return agentRoute(
    request,
    async (agent) => masterOnly(agent) ?? { status: 200, json: { contributions: await contributionQueue(d.db, d.now) } },
    { db: d.db, limiter: d.limiter },
  );
}

// POST /api/agent/contributions/review/: one verdict, re-validated by the server.
export function verdictRequest(request: Request, d: ReviewDeps): Promise<Response> {
  if (!contributorsEnabled()) return Promise.resolve(notFound());
  return agentRoute(
    request,
    async (agent) => {
      const refused = masterOnly(agent);
      if (refused) return refused;
      const body = await readJson(request, MAX_VERDICT_BYTES);
      if (!body.ok) return { status: body.response.status, json: await body.response.json() };
      return recordVerdict(d.db, agent, body.value, d);
    },
    { db: d.db, limiter: d.limiter },
  );
}
