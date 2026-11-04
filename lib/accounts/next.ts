import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { accountsEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { getAccount, type AccountView } from './sessions';
import { ACCOUNT_COOKIE } from './web';

// Next glue for account pages. Every page calls requireAccounts() first: with the flag off the whole area is a 404.
export function requireAccounts(): void {
  if (!accountsEnabled()) {
    notFound();
  }
}

export async function requireAccount(): Promise<AccountView> {
  requireAccounts();
  const token = (await cookies()).get(ACCOUNT_COOKIE)?.value ?? '';
  const account = await getAccount(getDb(), token, new Date());
  if (!account) {
    redirect('/account/sign-in/');
  }
  return account;
}
