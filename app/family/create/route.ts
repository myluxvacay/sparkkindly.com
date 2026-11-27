import { getDb } from '@/lib/db';
import { createCircleRequest } from '@/lib/family-hub/web';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return createCircleRequest(request, { db: getDb(), now: new Date() });
}
