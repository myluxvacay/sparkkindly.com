import { getDb } from '@/lib/db';
import { clickRequest } from '@/lib/sponsorship/web';

export const dynamic = 'force-dynamic';

// GET /go/<id>/ -> 302 to the sponsorship's stored link for an eligible viewer, home for anyone else (plan 6).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return clickRequest(request, { db: getDb(), now: new Date() }, id);
}
