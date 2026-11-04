import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { accountsEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { getContext, requireAdultContext, type AccountContext, type AdultContext } from './context';
import type { AccountView, ActiveProfile } from './sessions';
import { ACCOUNT_COOKIE } from './web';

// Next glue for account pages. Every page calls requireAccounts() first: with the flag off the whole area is a 404.
export function requireAccounts(): void {
  if (!accountsEnabled()) {
    notFound();
  }
}

export const PLAYING_PAGE = '/account/children/playing/';

export async function currentContext(): Promise<AccountContext | null> {
  return getContext(getDb(), (await cookies()).get(ACCOUNT_COOKIE)?.value ?? '', new Date());
}

// Adult-only pages. No session goes to sign-in; a child context goes to the "Playing as" page with the PIN form (it is
// signed in, just not as the adult), and never gets the page itself.
export async function requireAdult(): Promise<AdultContext> {
  requireAccounts();
  const ctx = await currentContext();
  if (!ctx) {
    redirect('/account/sign-in/');
  }
  const adult = requireAdultContext(ctx);
  if (!adult) {
    redirect(PLAYING_PAGE);
  }
  return adult;
}

export async function requireAccount(): Promise<AccountView> {
  return (await requireAdult()).account;
}

// The "Playing as" page: only for a child context; an adult context has nothing to switch back from.
export async function requireChild(): Promise<ActiveProfile> {
  requireAccounts();
  const ctx = await currentContext();
  if (!ctx) {
    redirect('/account/sign-in/');
  }
  if (!ctx.profile) {
    redirect('/account/children/');
  }
  return ctx.profile;
}
