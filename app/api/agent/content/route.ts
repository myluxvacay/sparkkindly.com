import { getDb } from '@/lib/db';
import { listPushQueue, submitPackage } from '@/lib/agents/content-push';
import { agentRoute, agentLimiter, readJson } from '@/lib/agents/http';
import { authenticate } from '@/lib/agents/auth';

export const dynamic = 'force-dynamic';

// POST /api/agent/content/  a library-shaped package (see docs/content-push-api.md). Submitter keys only.
export async function POST(request: Request) {
  const db = getDb();
  return agentRoute(
    request,
    async (agent) => {
      const body = await readJson(request);
      if (!body.ok) return { status: body.response.status, json: await body.response.json() };
      return submitPackage(db, agent, body.value);
    },
    { db, limiter: agentLimiter },
  );
}

// GET /api/agent/content/?status=in_review  the push queue (any push role; world agents see their world).
export async function GET(request: Request) {
  const db = getDb();
  try {
    const agent = await authenticate(db, request.headers.get('x-agent-key'));
    if (!agent) return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
    if (!['content', 'reviewer', 'promoter'].includes(agent.role))
      return Response.json({ error: 'forbidden_role' }, { status: 403, headers: { 'cache-control': 'no-store' } });
    if (!agentLimiter(String(agent.id)))
      return Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '60' } });
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const result = await listPushQueue(db, agent, {
      status: url.searchParams.get('status') ?? undefined,
      limit: Number.isFinite(limit) ? limit : 20,
    });
    return Response.json(result.json, { status: result.status, headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('agent api error:', (err as Error).message);
    return Response.json({ error: 'server_error' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
