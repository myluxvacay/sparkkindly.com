import type { Db } from '@/lib/db';
import { recordReviewReport, recordDigestPost } from './publishing';
import { agentRoute, readJson } from './http';

// The request layer of the publishing-report endpoints, with dependencies injected so tests can drive the real
// role checks (the routes below pass the process db and the shared limiter). Role isolation is the point of the
// two endpoints: only a reviewer key may report a batch, only a promoter key may report its digest post.

type Deps = { db: Db; limiter: (key: string) => boolean };

// POST /api/agent/publishing/report/  64 KB is plenty for a day's batch.
export async function reviewReportRequest(request: Request, deps: Deps): Promise<Response> {
  return agentRoute(
    request,
    async (agent) => {
      const body = await readJson(request, 64_000);
      if (!body.ok) return { status: body.response.status, json: await body.response.json() };
      return recordReviewReport(deps.db, agent, body.value);
    },
    { db: deps.db, limiter: deps.limiter, role: 'reviewer' },
  );
}

// POST /api/agent/publishing/digest/
export async function digestPostRequest(request: Request, deps: Deps): Promise<Response> {
  return agentRoute(
    request,
    async (agent) => {
      const body = await readJson(request, 8_000);
      if (!body.ok) return { status: body.response.status, json: await body.response.json() };
      return recordDigestPost(deps.db, agent, body.value);
    },
    { db: deps.db, limiter: deps.limiter, role: 'promoter' },
  );
}
