import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Stop invite emails', referrer: 'no-referrer' };

type Props = { searchParams: Promise<{ t?: string; r?: string }> };

// From an invite email sent to an address without an account. Opening the link changes nothing (a mail scanner may
// fetch it); the button POSTs. The token is not checked here, so the page is the same for any link. No flags: this must
// keep working whatever is switched on.
export default async function StopInvitesPage({ searchParams }: Props) {
  const { t, r } = await searchParams;
  if (r === 'done') {
    return (
      <>
        <h1>Stop invite emails</h1>
        <div role="status" id="result" tabIndex={-1} className="takeaway">
          <p>If the link was valid, this address will not get SparkKindly invite emails again.</p>
        </div>
      </>
    );
  }
  return (
    <>
      <h1>Stop invite emails</h1>
      <p>Someone invited this email address to a SparkKindly circle. You can make sure nobody can email you an invite again.</p>
      <form method="post" action="/circles/stop-invites/confirm/" className="prose admin-form">
        <input type="hidden" name="t" value={typeof t === 'string' ? t : ''} />
        <button type="submit" className="button">
          Never email me invites again
        </button>
      </form>
    </>
  );
}
