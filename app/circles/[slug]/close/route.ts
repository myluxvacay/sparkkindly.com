import { getDb } from '@/lib/db';
import { closeCircleRequest } from '@/lib/circles/web';

export const dynamic = 'force-dynamic';

// The flags, Origin, adult context and membership are checked inside closeCircleRequest.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return closeCircleRequest(request, { db: getDb(), now: new Date() }, (await params).slug);
}
