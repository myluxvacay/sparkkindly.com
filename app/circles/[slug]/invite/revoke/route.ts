import { getDb } from '@/lib/db';
import { revokeInviteRequest } from '@/lib/circles/invite-web';

export const dynamic = 'force-dynamic';

// The flags, Origin, adult context and membership are checked inside revokeInviteRequest.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return revokeInviteRequest(request, { db: getDb(), now: new Date() }, (await params).slug);
}
