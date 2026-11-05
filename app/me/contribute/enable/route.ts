import { getDb } from '@/lib/db';
import { enableRequest } from '@/lib/contributors/web';

export const dynamic = 'force-dynamic';

// The flags, Origin and adult context are checked inside enableRequest.
export async function POST(request: Request) {
  return enableRequest(request, { db: getDb(), now: new Date() });
}
