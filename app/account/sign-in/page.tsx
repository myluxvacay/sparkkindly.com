import Link from 'next/link';
import { requireAccounts } from '@/lib/accounts/next';
import { inviteReturnPath } from '@/lib/circles/invites';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ next?: string; sent?: string; expired?: string; r?: string }> };

export default async function AccountSignInPage({ searchParams }: Props) {
  requireAccounts();
  const { sent, expired, r, next: rawNext } = await searchParams;
  // An invite page the visitor came from (validated); the emailed sign-in link brings them back to it.
  const next = inviteReturnPath(rawNext);
  return (
    <>
      <h1>Sign in</h1>
      {sent === '1' && (
        <div role="status" className="takeaway">
          <p>If that address has an account, a link is on its way. It works once, for 15 minutes.</p>
        </div>
      )}
      {r === 'deleted' && (
        <div role="status" className="takeaway">
          <p>Your account and everything in it are deleted.</p>
        </div>
      )}
      {expired === '1' && (
        <div role="alert" className="grown-ups">
          <p>That link has expired or was already used. Ask for a new link.</p>
        </div>
      )}
      <form method="post" action="/account/sign-in/request/" className="prose admin-form">
        {next && <input type="hidden" name="next" value={next} />}
        <p>
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" required autoComplete="email" maxLength={254} />
        </p>
        <button type="submit" className="button">
          Email me a sign-in link
        </button>
      </form>
      <p>
        New here? <Link href="/account/sign-up/">Create an account</Link>.
      </p>
    </>
  );
}
