import { accountsEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { saveSettingsRequest } from '@/lib/accounts/settings-web';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!accountsEnabled()) return new Response('Not found', { status: 404 });
  return saveSettingsRequest(request, { db: getDb(), now: new Date() });
}
