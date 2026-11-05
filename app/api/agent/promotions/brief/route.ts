import { getDb } from '@/lib/db';
import { agentLimiter } from '@/lib/agents/http';
import { linkBase } from '@/lib/admin/sessions';
import { briefRequest } from '@/lib/social/promotions-api';

export const dynamic = 'force-dynamic';

// POST /api/agent/promotions/brief/  one video job's brief (promoter-role key only, plan 5B)
export async function POST(request: Request) {
  return briefRequest(request, { db: getDb(), now: new Date(), site: linkBase(process.env), limiter: agentLimiter });
}
