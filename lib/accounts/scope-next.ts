// Next glue for scope.ts: the scope every public page and route reads with. With ACCOUNTS_ENABLED off the cookie is
// never read, so the flag-off site behaves exactly as before. Reading the cookie makes the caller dynamic (no shared
// cache across visitors). Verified by tests/unit/account-scope.test.ts and tests/e2e/accounts.spec.ts.
import { cache } from 'react';
import { cookies } from 'next/headers';
import { accountsEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { anonymousScope, type Scope } from '@/lib/public/scope';
import { viewerForSession, type Viewer } from './scope';
import { ACCOUNT_COOKIE } from './web';

// The account cookie's value, or undefined (always undefined with the flag off).
export async function accountSessionToken(): Promise<string | undefined> {
  return accountsEnabled() ? (await cookies()).get(ACCOUNT_COOKIE)?.value : undefined;
}

// Memoized per request (React cache), so a page and its components share one session lookup. The viewer carries the
// scope and the owner answers are saved for (null when signed out or not allowed), from that one lookup.
export const currentViewer = cache(async (): Promise<Viewer> => {
  const token = await accountSessionToken();
  return token ? viewerForSession(getDb(), token, new Date()) : { scope: anonymousScope(), owner: null };
});

export const currentScope = async (): Promise<Scope> => (await currentViewer()).scope;
