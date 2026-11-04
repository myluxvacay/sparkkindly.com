import { after } from 'next/server';
import { accountsEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { submitSignUp } from '@/lib/accounts/web';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!accountsEnabled()) return new Response('Not found', { status: 404 });
  const defer = (work: () => Promise<void>) => after(work);
  return submitSignUp(request, { db: getDb(), env: process.env, now: new Date(), send: (m) => sendEmail(m), defer });
}
