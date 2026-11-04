import type { Metadata } from 'next';
import { requireAccounts } from '@/lib/accounts/next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Unsubscribe' };

type Props = { searchParams: Promise<{ t?: string; r?: string }> };

// Opening the email's link changes nothing (a mail scanner may fetch it); the button POSTs. The token is never read
// here, so the page is the same for a valid and an invalid link, and no account is needed.
export default async function UnsubscribePage({ searchParams }: Props) {
  requireAccounts();
  const { t, r } = await searchParams;
  if (r === 'done') {
    return (
      <>
        <h1>Unsubscribe</h1>
        <div role="status" id="result" tabIndex={-1} className="takeaway">
          <p>If the link was valid, that email is now turned off. You can change your choices in your account settings.</p>
        </div>
      </>
    );
  }
  return (
    <>
      <h1>Unsubscribe</h1>
      <p>Turn off the kind of email this link came from. Sign-in and consent emails are not affected.</p>
      <form method="post" action="/account/unsubscribe/confirm/" className="prose admin-form">
        <input type="hidden" name="t" value={typeof t === 'string' ? t : ''} />
        <button type="submit" className="button">
          Turn off this email
        </button>
      </form>
    </>
  );
}
