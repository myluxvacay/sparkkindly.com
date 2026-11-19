import { promosEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { enterPromoRequest } from '@/lib/promos/enter-web';

export const dynamic = 'force-dynamic';

// Draw entry for a promotion. The handler (lib/promos/enter-web.ts) derives the account from the session,
// requires the adult account-holder context and the 18+ attestation, and answers with a redirect code only.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!promosEnabled()) return new Response('Not found', { status: 404 });
  return enterPromoRequest(request, (await params).slug, { db: getDb(), now: new Date() });
}
