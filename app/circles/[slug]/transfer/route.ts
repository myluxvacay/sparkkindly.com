import { getDb } from '@/lib/db';
import { transferRequest } from '@/lib/circles/web';

export const dynamic = 'force-dynamic';

// The flags, Origin, adult context and membership are checked inside transferRequest.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return transferRequest(request, { db: getDb(), now: new Date() }, (await params).slug);
}
