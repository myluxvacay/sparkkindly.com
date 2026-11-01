import { getDb } from '@/lib/db';
import { getBrief } from '@/lib/agents/api';
import { agentRoute, agentLimiter } from '@/lib/agents/http';

export const dynamic = 'force-dynamic';

// GET /api/agent/brief/?world=<slug>  (the world is only needed by the master agent)
export async function GET(request: Request) {
  const db = getDb();
  return agentRoute(request, (agent) => getBrief(db, agent, new URL(request.url).searchParams.get('world')), { db, limiter: agentLimiter });
}
