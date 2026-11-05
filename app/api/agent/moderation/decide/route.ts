import { getDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { agentLimiter } from '@/lib/agents/http';
import { decideRequest } from '@/lib/comments/moderation-api';

export const dynamic = 'force-dynamic';

// POST /api/agent/moderation/decide/  one decision on one comment (moderation-role key only)
export async function POST(request: Request) {
  return decideRequest(request, { db: getDb(), now: new Date(), env: process.env, send: (m) => sendEmail(m), limiter: agentLimiter });
}
