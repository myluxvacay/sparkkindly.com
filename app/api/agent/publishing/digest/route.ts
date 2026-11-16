import { getDb } from '@/lib/db';
import { recordDigestPost } from '@/lib/agents/publishing';
import { agentRoute, agentLimiter, readJson } from '@/lib/agents/http';

export const dynamic = 'force-dynamic';

// POST /api/agent/publishing/digest/  the promoter (social) agent reports a batch's Facebook digest post: its URL
// and/or platform post id. Promoter-role key only. Idempotent per batch date; touches only the digest fields.
export async function POST(request: Request) {
  const db = getDb();
  return agentRoute(
    request,
    async (agent) => {
      const body = await readJson(request, 8_000);
      if (!body.ok) return { status: body.response.status, json: await body.response.json() };
      return recordDigestPost(db, agent, body.value);
    },
    { db, limiter: agentLimiter, role: 'promoter' },
  );
}
