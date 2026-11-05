import { getDb } from '@/lib/db';
import { removeMemberRequest } from '@/lib/circles/web';

export const dynamic = 'force-dynamic';

// The flags, Origin, adult context and membership are checked inside removeMemberRequest.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return removeMemberRequest(request, { db: getDb(), now: new Date() }, (await params).slug);
}
