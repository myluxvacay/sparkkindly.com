// The two moderation agent routes as plain functions of a Request (plan 7B), so they test without Next: the flags, then
// agentRoute with role 'moderation' (a content key gets 403, a missing, disabled or rotated key 401, both with no data),
// the shared per-agent limiter, and a 4 KB body cap on decide. No Next.js imports.
// Verified by tests/unit/agent-moderation-api.test.ts.
import { agentRoute, readJson } from '@/lib/agents/http';
import { commentsEnabled } from '@/lib/config';
import type { Db } from '@/lib/db';
import { decide, moderationQueue, type DecideDeps } from './moderation';

export type ModerationDeps = DecideDeps & { db: Db; now: Date; limiter: (key: string) => boolean };

const MAX_DECISION_BYTES = 4_096;
const notFound = () => Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } });

// GET /api/agent/moderation/: up to 20 comments needing a decision.
export function queueRequest(request: Request, d: ModerationDeps): Promise<Response> {
  if (!commentsEnabled()) return Promise.resolve(notFound());
  return agentRoute(request, async () => ({ status: 200, json: { comments: await moderationQueue(d.db, d.now) } }), {
    db: d.db,
    limiter: d.limiter,
    role: 'moderation',
  });
}

// POST /api/agent/moderation/decide/: one decision, re-validated by the server.
export function decideRequest(request: Request, d: ModerationDeps): Promise<Response> {
  if (!commentsEnabled()) return Promise.resolve(notFound());
  return agentRoute(
    request,
    async (agent) => {
      const body = await readJson(request, MAX_DECISION_BYTES);
      if (!body.ok) return { status: body.response.status, json: await body.response.json() };
      return decide(d.db, agent, body.value, d.now, d);
    },
    { db: d.db, limiter: d.limiter, role: 'moderation' },
  );
}
