import { getDb } from '@/lib/db';
import { stopInvitesRequest } from '@/lib/circles/invite-web';

export const dynamic = 'force-dynamic';

// No flags, sign-in or Origin check on purpose: a link from an invite email must always be able to stop further invites.
export async function POST(request: Request) {
  return stopInvitesRequest(request, { db: getDb(), env: process.env });
}
