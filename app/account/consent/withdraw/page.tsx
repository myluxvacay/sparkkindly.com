import type { Metadata } from 'next';
import Link from 'next/link';
import { consentTarget } from '@/lib/accounts/consent';
import { requireAccounts } from '@/lib/accounts/next';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
// strict-origin: a link on this page never sends the token-bearing URL as a Referer, while form posts keep their Origin.
export const metadata: Metadata = {
  title: 'Delete a SparkKindly account',
  robots: { index: false, follow: false },
  referrer: 'strict-origin',
};

type Props = { searchParams: Promise<{ token?: string }> };

// The parent's delete link only shows the consequences and a button; the deletion is the POST, so a mail scanner
// fetching the link deletes nothing. The outcome is shown on /account/consent/.
export default async function ConsentWithdrawPage({ searchParams }: Props) {
  requireAccounts();
  const { token } = await searchParams;
  const target = typeof token === 'string' ? await consentTarget(getDb(), token, 'withdraw', new Date()) : null;
  if (!target) {
    return (
      <>
        <h1>This link is not valid</h1>
        <p role="alert">The account may already be deleted, or the link is no longer in use.</p>
      </>
    );
  }
  return (
    <>
      <h1>Delete your child&apos;s SparkKindly account</h1>
      <div className="prose">
        <p>This link was sent to {target.maskedParent}, given as the parent or guardian of a young person aged 13 to 15.</p>
        <h2>What deleting does</h2>
        <ul>
          <li>The account is closed straight away and they are signed out everywhere.</li>
          <li>Their email address, date of birth, interests, quiz answers and scores are deleted.</li>
          <li>This cannot be undone. They can sign up again later, which starts a new request to you.</li>
        </ul>
        <p>
          Read <Link href="/privacy/" rel="noreferrer">how we handle personal data</Link>.
        </p>
      </div>
      <form method="post" action="/account/consent/withdraw/confirm/" className="prose admin-form">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="button">
          Delete the account
        </button>
      </form>
    </>
  );
}
