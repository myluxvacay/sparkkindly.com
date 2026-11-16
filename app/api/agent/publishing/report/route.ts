import { getDb } from '@/lib/db';
import { recordReviewReport } from '@/lib/agents/publishing';
import { agentRoute, agentLimiter, readJson } from '@/lib/agents/http';

export const dynamic = 'force-dynamic';

// POST /api/agent/publishing/report/  the reviewer agent reports one finished batch: the items it published and
// the items it rejected, with reasons. Reviewer-role key only. Idempotent per batch date (a retry replaces the
// same lists). 64 KB is plenty for a day's batch.
export async function POST(request: Request) {
  const db = getDb();
  return agentRoute(
    request,
    async (agent) => {
      const body = await readJson(request, 64_000);
      if (!body.ok) return { status: body.response.status, json: await body.response.json() };
      return recordReviewReport(db, agent, body.value);
    },
    { db, limiter: agentLimiter, role: 'reviewer' },
  );
}
