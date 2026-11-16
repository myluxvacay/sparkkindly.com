import { getDb } from '@/lib/db';
import { reviewReportRequest } from '@/lib/agents/publishing-api';
import { agentLimiter } from '@/lib/agents/http';

export const dynamic = 'force-dynamic';

// POST /api/agent/publishing/report/  the reviewer agent reports one finished batch: the items it published and
// the items it rejected, with reasons. Reviewer-role key only. Idempotent per batch date (a retry replaces the
// same lists).
export async function POST(request: Request) {
  return reviewReportRequest(request, { db: getDb(), limiter: agentLimiter });
}
