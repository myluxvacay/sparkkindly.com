import { getDb } from '@/lib/db';
import { agentLimiter } from '@/lib/agents/http';
import { linkBase } from '@/lib/admin/sessions';
import { copyRequest } from '@/lib/social/promotions-api';

export const dynamic = 'force-dynamic';

// POST /api/agent/promotions/copy/  one entry's caption and hashtags (promoter-role key only)
export async function POST(request: Request) {
  return copyRequest(request, { db: getDb(), now: new Date(), site: linkBase(process.env), limiter: agentLimiter });
}
