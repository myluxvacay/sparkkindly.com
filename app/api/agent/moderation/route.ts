import { getDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { agentLimiter } from '@/lib/agents/http';
import { queueRequest } from '@/lib/comments/moderation-api';

export const dynamic = 'force-dynamic';

// GET /api/agent/moderation/  the moderation agent's queue (moderation-role key only)
export async function GET(request: Request) {
  return queueRequest(request, { db: getDb(), now: new Date(), env: process.env, send: (m) => sendEmail(m), limiter: agentLimiter });
}
