import { getDb } from '@/lib/db';
import { getPushStatus } from '@/lib/agents/content-push';
import { agentLimiter } from '@/lib/agents/http';
import { authenticate } from '@/lib/agents/auth';

export const dynamic = 'force-dynamic';

// GET /api/agent/content/<id>/  one pushed item's workflow status (any push role: the submitter tracks
// its package, the reviewer and promoter track their steps). Same 401/403/429 behaviour as agentRoute;
// written out because this route accepts three roles where agentRoute takes one.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  try {
    const agent = await authenticate(db, request.headers.get('x-agent-key'));
    if (!agent) return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
    if (!['content', 'reviewer', 'promoter'].includes(agent.role))
      return Response.json({ error: 'forbidden_role' }, { status: 403, headers: { 'cache-control': 'no-store' } });
    if (!agentLimiter(String(agent.id)))
      return Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '60' } });
    const { id } = await params;
    const result = await getPushStatus(db, agent, id);
    return Response.json(result.json, { status: result.status, headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('agent api error:', (err as Error).message);
    return Response.json({ error: 'server_error' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
