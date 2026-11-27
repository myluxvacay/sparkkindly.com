import { getDb } from '@/lib/db';
import { pushUnsubscribeRequest } from '@/lib/family-hub/push-web';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return pushUnsubscribeRequest(request, { db: getDb(), now: new Date() });
}
