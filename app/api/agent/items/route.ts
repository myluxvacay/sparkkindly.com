import { getDb } from '@/lib/db';
import { submitItem } from '@/lib/agents/api';
import { agentRoute, agentLimiter, readJson } from '@/lib/agents/http';

export const dynamic = 'force-dynamic';

// POST /api/agent/items/  with a JSON item (see docs/item-format.md)
export async function POST(request: Request) {
  const db = getDb();
  return agentRoute(
    request,
    async (agent) => {
      const body = await readJson(request);
      if (!body.ok) return { status: body.response.status, json: await body.response.json() };
      return submitItem(db, agent, body.value);
    },
    { db, limiter: agentLimiter },
  );
}
