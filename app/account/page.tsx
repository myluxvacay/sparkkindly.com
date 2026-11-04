import { requireAccount } from '@/lib/accounts/next';
import type { AccountView } from '@/lib/accounts/sessions';

export const dynamic = 'force-dynamic';

function ageWording(a: AccountView): string {
  switch (a.ageGroup) {
    case 'adult':
      return 'Adult account';
    case 'teen_16_17':
      return 'Age 16 to 17';
    default:
      return a.consent === 'confirmed' ? 'Age 13 to 15' : 'Age 13 to 15, consent pending';
  }
}

export default async function AccountPage() {
  const account = await requireAccount();
  const pending = account.ageGroup === 'teen_13_15' && account.consent !== 'confirmed';
  return (
    <>
      <h1>Your account</h1>
      <dl className="admin-facts">
        <dt>Email</dt>
        <dd>{account.email}</dd>
        <dt>Account type</dt>
        <dd>{ageWording(account)}</dd>
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
