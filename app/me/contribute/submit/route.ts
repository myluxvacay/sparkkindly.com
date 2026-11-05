import { getDb } from '@/lib/db';
import { submitRequest } from '@/lib/contributors/web';

export const dynamic = 'force-dynamic';

// The flags, Origin and adult context are checked inside submitRequest.
export async function POST(request: Request) {
  return submitRequest(request, { db: getDb(), now: new Date() });
}
