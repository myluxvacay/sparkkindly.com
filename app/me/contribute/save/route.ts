import { getDb } from '@/lib/db';
import { saveRequest } from '@/lib/contributors/web';

export const dynamic = 'force-dynamic';

// The flags, Origin and adult context are checked inside saveRequest.
export async function POST(request: Request) {
  return saveRequest(request, { db: getDb(), now: new Date() });
}
