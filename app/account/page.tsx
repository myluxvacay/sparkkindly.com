import { requireAccount } from '@/lib/accounts/next';
import { consentPending } from '@/lib/accounts/policy';
import { ageWording } from '@/lib/accounts/wording';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const account = await requireAccount();
  const pending = consentPending(account.ageGroup, account.consent);
  return (
    <>
      <h1>Your account</h1>
      <dl className="admin-facts">
        <dt>Email</dt>
        <dd>{account.email}</dd>
        <dt>Account type</dt>
        <dd>{ageWording(account.ageGroup, account.consent)}</dd>
      </dl>
      {pending && (
        <p role="status">
          Consent is pending. Until a parent or guardian confirms the account, it can save interests only.
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
