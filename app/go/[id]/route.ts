import { getDb } from '@/lib/db';
import { clickHead, clickRequest } from '@/lib/sponsorship/web';

export const dynamic = 'force-dynamic';

// GET /go/<id>/ -> 302 to the sponsorship's stored link for an eligible viewer, home for anyone else (plan 6).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return clickRequest(request, { db: getDb(), now: new Date() }, id);
}

// HEAD never counts (without it Next answers HEAD by running GET). OPTIONS is answered by Next itself, never by GET.
export function HEAD() {
  return clickHead();
}
