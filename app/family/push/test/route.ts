import { getDb } from '@/lib/db';
import { pushTestRequest } from '@/lib/family-hub/push-web';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return pushTestRequest(request, { db: getDb(), now: new Date() });
}
