import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdult } from '@/lib/accounts/next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Delete your account' };

type Props = { searchParams: Promise<{ r?: string }> };

// The confirm step: opening it deletes nothing; the POST needs the account email typed. A mismatch comes back with a
// neutral message that never repeats what was typed.
export default async function DeleteAccountPage({ searchParams }: Props) {
  await requireAdult();
  const { r } = await searchParams;
  const mismatch = r === 'mismatch';
  return (
    <>
      <h1>Delete your account</h1>
      {mismatch && (
        <div role="alert" id="result" tabIndex={-1} className="grown-ups">
          <p>That did not match the email address of this account. Nothing was deleted.</p>
        </div>
      )}
      <div className="prose">
        <h2>What is deleted</h2>
        <ul>
          <li>Your account: email address, date of birth, time zone and email choices</li>
          <li>Any sign-in links still waiting to be used</li>
          <li>Parent or guardian consent records</li>
          <li>Every child profile on this account</li>
          <li>The interests you and your child profiles chose</li>
          <li>Every quiz answer and score</li>
        </ul>
        <p>
          It happens straight away and you are signed out everywhere. This cannot be undone. Copies in our backups age
          out within 30 days.
        </p>
      </div>
      <form method="post" action="/account/settings/delete/confirm/" className="prose admin-form">
        <p>
          <label htmlFor="email">Type your account email address to confirm</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="off"
            maxLength={254}
            aria-describedby={mismatch ? 'result' : undefined}
            aria-invalid={mismatch || undefined}
          />
        </p>
        <div className="admin-actions">
          <button type="submit" className="button">
            Delete my account
          </button>
          <Link href="/account/settings/">Keep it</Link>
        </div>
      </form>
    </>
  );
}
