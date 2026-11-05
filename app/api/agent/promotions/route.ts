import { getDb } from '@/lib/db';
import { agentLimiter } from '@/lib/agents/http';
import { linkBase } from '@/lib/admin/sessions';
import { promotionsQueueRequest } from '@/lib/social/promotions-api';

export const dynamic = 'force-dynamic';

// GET /api/agent/promotions/  the promotion agent's queue (promoter-role key only)
export async function GET(request: Request) {
  return promotionsQueueRequest(request, { db: getDb(), now: new Date(), site: linkBase(process.env), limiter: agentLimiter });
}
