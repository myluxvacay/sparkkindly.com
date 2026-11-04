import Link from 'next/link';
import { requireAccount } from '@/lib/accounts/next';
import { can, consentPending } from '@/lib/accounts/policy';
import { ageWording, consentDay } from '@/lib/accounts/wording';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ consent?: string }> };

export default async function AccountPage({ searchParams }: Props) {
  const account = await requireAccount();
  const { consent } = await searchParams;
  const pending = consentPending(account.ageGroup, account.consent);
  return (
    <>
      <h1>Your account</h1>
      {consent === 'resent' && (
        <div role="status" id="result" tabIndex={-1} className="takeaway">
          <p>We emailed your parent or guardian again.</p>
        </div>
      )}
      {consent === 'wait' && (
        <div role="alert" id="result" tabIndex={-1} className="grown-ups">
          <p>An email was sent within the last hour. Please wait before asking again.</p>
        </div>
      )}
      <dl className="admin-facts">
        <dt>Email</dt>
        <dd>{account.email}</dd>
        <dt>Account type</dt>
        <dd>{ageWording(account.ageGroup, account.consent)}</dd>
        {account.ageGroup === 'teen_13_15' && account.consentAt && (
          <>
            <dt>Parent or guardian consent</dt>
            <dd>Recorded on {consentDay(account.consentAt)}</dd>
          </>
        )}
      </dl>
      {pending && (
        <p role="status">
          Waiting for your parent or guardian to confirm. Until they do, the account can save interests only.
        </p>
      )}
      {account.consent === 'pending' && (
        <form method="post" action="/account/consent/resend/" style={{ marginBottom: 16 }}>
          <p>Did the email not arrive? Ask them to check their spam folder, or send it again.</p>
          <button type="submit" className="button">
            Email my parent or guardian again
          </button>
        </form>
      )}
      <p>
        <Link href="/me/">Your page</Link> · <Link href="/me/interests/">Choose your interests</Link> ·{' '}
        <Link href="/account/settings/">Settings</Link>
      </p>
      {can(account.ageGroup, account.consent, 'create_child_profile') && (
        <p>
          <Link href="/account/children/">Child profiles</Link>
        </p>
      )}
      <form method="post" action="/account/sign-out/">
        <button type="submit" className="button">
          Sign out
        </button>
      </form>
    </>
  );
}
