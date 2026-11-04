import { accountsEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { deleteChildRequest } from '@/lib/accounts/children-web';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!accountsEnabled()) return new Response('Not found', { status: 404 });
  return deleteChildRequest(request, { db: getDb(), now: new Date() });
}
