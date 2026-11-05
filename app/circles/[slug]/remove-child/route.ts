import { getDb } from '@/lib/db';
import { removeChildRequest } from '@/lib/circles/web';

export const dynamic = 'force-dynamic';

// The flags, Origin, adult context and membership are checked inside removeChildRequest.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return removeChildRequest(request, { db: getDb(), now: new Date() }, (await params).slug);
}
