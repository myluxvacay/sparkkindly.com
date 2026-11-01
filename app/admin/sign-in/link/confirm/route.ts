import { getDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { confirmLink } from '@/lib/admin/sign-in';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return confirmLink(request, { db: getDb(), env: process.env, now: new Date(), send: (m) => sendEmail(m) });
}
