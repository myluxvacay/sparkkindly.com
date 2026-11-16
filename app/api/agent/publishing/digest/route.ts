import { getDb } from '@/lib/db';
import { digestPostRequest } from '@/lib/agents/publishing-api';
import { agentLimiter } from '@/lib/agents/http';

export const dynamic = 'force-dynamic';

// POST /api/agent/publishing/digest/  the promoter (social) agent reports a batch's Facebook digest post: its URL
// and/or platform post id. Promoter-role key only. Idempotent per batch date; touches only the digest fields.
export async function POST(request: Request) {
  return digestPostRequest(request, { db: getDb(), limiter: agentLimiter });
}
