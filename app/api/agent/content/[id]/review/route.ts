import { getDb } from '@/lib/db';
import { reviewPushItem } from '@/lib/agents/content-push';
import { agentRoute, agentLimiter, readJson } from '@/lib/agents/http';

export const dynamic = 'force-dynamic';

// POST /api/agent/content/<id>/review/  { decision: 'approve' | 'reject', reason?, sourcesChecked?, solvedAnswer? }
// Reviewer keys only. Approval assigns the item its slot (articles) or its globally unique quiz date.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const { id } = await params;
  return agentRoute(
    request,
    async (agent) => {
      const body = await readJson(request);
      if (!body.ok) return { status: body.response.status, json: await body.response.json() };
      return reviewPushItem(db, agent, id, body.value);
    },
    { db, limiter: agentLimiter, role: 'reviewer' },
  );
}
