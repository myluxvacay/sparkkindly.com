import { cookies } from 'next/headers';
import { currentAccount, requireAccounts } from '@/lib/accounts/next';
import { linkTarget } from '@/lib/accounts/sessions';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ token?: string }> };

// Opening the emailed link only shows this button: the token is used by the POST, so a mail scanner that fetches the
// link cannot use it up or sign in. The page names the account the link signs into (so a link planted by someone else
// is visible as such) and warns when that would switch away from the account already signed in here. An invalid, used
// or expired link gets the same generic page whatever the reason.
export default async function AccountLinkPage({ searchParams }: Props) {
  requireAccounts();
  const { token } = await searchParams;
  const target = typeof token === 'string' ? await linkTarget(getDb(), token, new Date()) : null;
  const current = target ? await currentAccount(await cookies()) : null;
  return (
    <>
      <h1>Continue signing in</h1>
      {target ? (
        <form method="post" action="/account/sign-in/link/confirm/" className="prose admin-form">
          <input type="hidden" name="token" value={token} />
          <p>
            Sign in as <strong>{target}</strong>
          </p>
          {current && current.email !== target && (
            <p role="status">You are signed in as {current.email}. Continuing will switch accounts.</p>
          )}
          <button type="submit" className="button">
            Continue
          </button>
        </form>
      ) : (
        <p role="alert">This link is not valid. Ask for a new one from the sign-in page.</p>
      )}
    </>
  );
}
