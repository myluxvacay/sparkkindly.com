import type { Metadata } from 'next';
import Link from 'next/link';
import { consentTarget } from '@/lib/accounts/consent';
import { CONSENT_HOLDS } from '@/lib/accounts/consent-email';
import { requireAccounts } from '@/lib/accounts/next';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
// strict-origin: a link on this page never sends the token-bearing URL as a Referer, while form posts keep their Origin.
export const metadata: Metadata = {
  title: 'Parent or guardian consent',
  robots: { index: false, follow: false },
  referrer: 'strict-origin',
};

type Props = { searchParams: Promise<{ token?: string; done?: string; invalid?: string }> };

// The heading is the landing target of the #result redirect, so focus starts on the outcome.
const Result = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <>
    <h1 id="result" tabIndex={-1}>
      {title}
    </h1>
    {children}
  </>
);

// Opening the parent's link only shows what the account holds and a button: the token is used by the POST, so a mail
// scanner fetching the link confirms nothing. An invalid, used or expired link gets one generic answer.
export default async function ConsentPage({ searchParams }: Props) {
  requireAccounts();
  const { token, done, invalid } = await searchParams;
  if (done === 'confirmed') {
    return (
      <Result title="Thank you, consent is recorded">
        <p>The account stays open. You can still delete it at any time with the delete link in the same email.</p>
      </Result>
    );
  }
  if (done === 'withdrawn') {
    return (
      <Result title="The account has been deleted">
        <p>The account and everything it held are gone. Nothing more will be sent to you about it.</p>
      </Result>
    );
  }
  const target =
    invalid !== '1' && typeof token === 'string' ? await consentTarget(getDb(), token, 'confirm', new Date()) : null;
  if (!target || target.state !== 'pending') {
    return (
      <Result title="This link is not valid">
        <p role="alert">
          The link has expired, was already used or was replaced by a newer email. The young person can ask for a new
          email from their account page.
        </p>
      </Result>
    );
  }
  return (
    <>
      <h1>Confirm your child&apos;s SparkKindly account</h1>
      <div className="prose">
        <p>This link was sent to {target.maskedParent}, given as the parent or guardian of a young person aged 13 to 15.</p>
        <h2>What the account holds</h2>
        <ul>
          {CONSENT_HOLDS.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
        <h2>What the account cannot do</h2>
        <p>
          Post public comments, join communities, contribute content, create child profiles or have a profile page.
        </p>
        <p>
          Read <Link href="/privacy/" rel="noreferrer">how we handle personal data</Link>. If you would rather delete the
          account, use the delete link in the same email.
        </p>
      </div>
      <form method="post" action="/account/consent/confirm/" className="prose admin-form">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="button">
          Confirm and keep the account
        </button>
      </form>
    </>
  );
}
