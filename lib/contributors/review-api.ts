// The two contribution routes for the reviewer pass (plan 8) as plain functions of a Request, so they test without Next:
// the flags (404 when off), then agentRoute with the reviewer role only (plan 8 review H1: content, world and moderation
// keys get 403; a missing, disabled or rotated key 401), the shared per-agent limiter and an 8 KB body cap on verdicts.
// The review run's key therefore cannot submit items, and no content key can post a verdict. No Next.js imports. Verified by tests/unit/contributors-review-api.test.ts.
import { agentRoute, readJson } from '@/lib/agents/http';
import { contributorsEnabled } from '@/lib/config';
import type { Db } from '@/lib/db';
import { contributionQueue, recordVerdict, type VerdictDeps } from './review';

export type ReviewDeps = VerdictDeps & { db: Db; now: Date; limiter: (key: string) => boolean };

const MAX_VERDICT_BYTES = 8_192;
const notFound = () => Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } });

// GET /api/agent/contributions/: up to 5 contributions waiting for the reviewer.
export function queueRequest(request: Request, d: ReviewDeps): Promise<Response> {
  if (!contributorsEnabled()) return Promise.resolve(notFound());
  return agentRoute(
    request,
    async () => ({ status: 200, json: { contributions: await contributionQueue(d.db, d.now) } }),
    { db: d.db, limiter: d.limiter, role: 'reviewer' },
  );
}

// POST /api/agent/contributions/review/: one verdict, re-validated by the server.
export function verdictRequest(request: Request, d: ReviewDeps): Promise<Response> {
  if (!contributorsEnabled()) return Promise.resolve(notFound());
  return agentRoute(
    request,
    async (agent) => {
      const body = await readJson(request, MAX_VERDICT_BYTES);
      if (!body.ok) return { status: body.response.status, json: await body.response.json() };
      return recordVerdict(d.db, agent, body.value, d);
    },
    { db: d.db, limiter: d.limiter, role: 'reviewer' },
  );
}
