import { getDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { emailInviteRequest, inviteSender } from '@/lib/circles/invite-web';

export const dynamic = 'force-dynamic';

// The flags, Origin, adult context, membership and limits are checked inside emailInviteRequest.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const db = getDb();
  const send = inviteSender(process.env, (m) => sendEmail(m), db);
  return emailInviteRequest(request, { db, now: new Date(), send }, (await params).slug);
}
