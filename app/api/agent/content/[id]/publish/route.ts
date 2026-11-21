import { getDb } from '@/lib/db';
import { publishPushItem } from '@/lib/agents/content-push';
import { agentRoute, agentLimiter } from '@/lib/agents/http';

export const dynamic = 'force-dynamic';

// POST /api/agent/content/<id>/publish/  promoter keys only. Publishes an approved item at once; a video
// component flips to public on YouTube as part of the same step, before the item goes public.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const { id } = await params;
  return agentRoute(request, async (agent) => publishPushItem(db, agent, id), { db, limiter: agentLimiter, role: 'promoter' });
}
