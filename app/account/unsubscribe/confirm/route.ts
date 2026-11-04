import { accountsEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { unsubscribeRequest } from '@/lib/accounts/settings-web';

export const dynamic = 'force-dynamic';

// The one-click target for a future List-Unsubscribe header (RFC 8058) and the unsubscribe page's button. No Origin
// or session check on purpose: mail clients post it. A page and a route cannot share /account/unsubscribe/ in Next.
export async function POST(request: Request) {
  if (!accountsEnabled()) return new Response('Not found', { status: 404 });
  return unsubscribeRequest(request, { db: getDb(), env: process.env });
}
