import { getDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { reportCommentRequest } from '@/lib/comments/report-web';

export const dynamic = 'force-dynamic';

// The flags, Origin and adult context are checked inside reportCommentRequest.
export async function POST(request: Request) {
  return reportCommentRequest(request, { db: getDb(), now: new Date(), env: process.env, send: (m) => sendEmail(m) });
}
