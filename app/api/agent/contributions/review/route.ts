import { getDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { agentLimiter } from '@/lib/agents/http';
import { verdictRequest } from '@/lib/contributors/review-api';

export const dynamic = 'force-dynamic';

// POST /api/agent/contributions/review/  one reviewer verdict (contribution reviewer key only: role 'reviewer')
export async function POST(request: Request) {
  return verdictRequest(request, { db: getDb(), now: new Date(), env: process.env, send: (m) => sendEmail(m), limiter: agentLimiter });
}
