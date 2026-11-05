import { getDb } from '@/lib/db';
import { createCircleRequest } from '@/lib/circles/web';

export const dynamic = 'force-dynamic';

// The flags are checked inside createCircleRequest (404 with either off).
export async function POST(request: Request) {
  return createCircleRequest(request, { db: getDb(), now: new Date() });
}
