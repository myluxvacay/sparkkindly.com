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

export async function currentAccount(jar: Awaited<ReturnType<typeof cookies>>): Promise<AccountView | null> {
  return getAccount(getDb(), jar.get(ACCOUNT_COOKIE)?.value ?? '', new Date());
}

export async function requireAccount(): Promise<AccountView> {
  requireAccounts();
  const account = await currentAccount(await cookies());
  if (!account) {
    redirect('/account/sign-in/');
  }
  return account;
}
