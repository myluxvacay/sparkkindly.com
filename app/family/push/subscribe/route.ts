import { getDb } from '@/lib/db';
import { pushSubscribeRequest } from '@/lib/family-hub/push-web';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return pushSubscribeRequest(request, { db: getDb(), now: new Date() });
}
