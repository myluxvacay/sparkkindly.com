import { getDb } from '@/lib/db';
import { joinCommunityRequest } from '@/lib/circles/invite-web';

export const dynamic = 'force-dynamic';

// The flags, Origin, adult context and the join rules are checked inside joinCommunityRequest.
export async function POST(request: Request) {
  return joinCommunityRequest(request, { db: getDb(), now: new Date() });
}
