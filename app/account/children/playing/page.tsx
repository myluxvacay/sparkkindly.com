import type { Metadata } from 'next';
import Link from 'next/link';
import { requireChild } from '@/lib/accounts/next';
import { PinInput } from '@/components/PinInput';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Playing as a child profile' };

type Props = { searchParams: Promise<{ r?: string }> };

// Neutral on purpose: no attempts left, no time remaining.
const ERRORS: Record<string, string> = {
  wrong: 'That PIN was not right. Please try again.',
  locked: 'Too many tries. Please try again later, or ask an adult to sign in again with an email link.',
};

// Where a child context lands for /account/ and every adult-only page: who is playing, and the PIN form to switch back.
export default async function PlayingPage({ searchParams }: Props) {
  const profile = await requireChild();
  const { r } = await searchParams;
  const error = r ? ERRORS[r] : undefined;
  return (
    <>
      <h1>Playing as {profile.displayName}</h1>
      <p>
        <Link href="/kids/">Go to the Kids world</Link>
      </p>
      {error && (
        <div role="alert" id="result" tabIndex={-1} className="grown-ups">
          <p>{error}</p>
        </div>
      )}
      <form method="post" action="/account/children/switch-back/" className="prose admin-form">
        <h2>Switch back (PIN)</h2>
        <p id="switch-hint">For the grown-up who set up this profile.</p>
        <PinInput id="pin" label="Adult PIN" entry describedBy={['switch-hint', error ? 'result' : undefined]} />
        <button type="submit" className="button">
          Switch back
        </button>
      </form>
    </>
  );
}
