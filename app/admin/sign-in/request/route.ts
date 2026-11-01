import { getDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { requestSignIn } from '@/lib/admin/sign-in';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return requestSignIn(request, { db: getDb(), env: process.env, now: new Date(), send: (m) => sendEmail(m) });
}
