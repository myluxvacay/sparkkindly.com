import { getDb } from '@/lib/db';
import { withdrawRequest } from '@/lib/contributors/web';

export const dynamic = 'force-dynamic';

// The flags, Origin and adult context are checked inside withdrawRequest.
export async function POST(request: Request) {
  return withdrawRequest(request, { db: getDb(), now: new Date() });
}
