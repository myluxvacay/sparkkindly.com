import { getDb } from '@/lib/db';
import { acceptInviteRequest } from '@/lib/circles/invite-web';

export const dynamic = 'force-dynamic';

// The flags, Origin, network allowance and adult context are checked inside acceptInviteRequest; the token decides the circle.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return acceptInviteRequest(request, { db: getDb(), now: new Date() }, (await params).token);
}
