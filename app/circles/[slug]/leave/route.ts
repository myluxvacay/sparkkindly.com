import { getDb } from '@/lib/db';
import { leaveCircleRequest } from '@/lib/circles/web';

export const dynamic = 'force-dynamic';

// The flags, Origin, adult context and membership are checked inside leaveCircleRequest.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return leaveCircleRequest(request, { db: getDb(), now: new Date() }, (await params).slug);
}
