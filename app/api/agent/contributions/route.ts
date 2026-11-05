import { getDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { agentLimiter } from '@/lib/agents/http';
import { queueRequest } from '@/lib/contributors/review-api';

export const dynamic = 'force-dynamic';

// GET /api/agent/contributions/  contributions waiting for the reviewer (master content key only)
export async function GET(request: Request) {
  return queueRequest(request, { db: getDb(), now: new Date(), env: process.env, send: (m) => sendEmail(m), limiter: agentLimiter });
}
