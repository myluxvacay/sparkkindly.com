import { getDb } from '@/lib/db';
import { getItemStatus } from '@/lib/agents/api';
import { agentRoute, agentLimiter } from '@/lib/agents/http';

export const dynamic = 'force-dynamic';

// GET /api/agent/items/<id>/  -> the item's status and quality report
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const { id } = await params;
  return agentRoute(request, (agent) => getItemStatus(db, agent, id), { db, limiter: agentLimiter });
}
