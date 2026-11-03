import { getDb } from '@/lib/db';
import { recordRun } from '@/lib/agents/runs';
import { agentRoute, agentLimiter, readJson } from '@/lib/agents/http';

export const dynamic = 'force-dynamic';

// POST /api/agent/runs/  the master agent reports one finished run (counts and timings, no content). 8 KB is plenty.
export async function POST(request: Request) {
  const db = getDb();
  return agentRoute(
    request,
    async (agent) => {
      const body = await readJson(request, 8_000);
      if (!body.ok) return { status: body.response.status, json: await body.response.json() };
      return recordRun(db, agent, body.value);
    },
    { db, limiter: agentLimiter },
  );
}
