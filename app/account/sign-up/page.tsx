import Link from 'next/link';
import { requireAccounts } from '@/lib/accounts/next';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ sent?: string; under13?: string; parent?: string; invalid?: string }> };

export default async function AccountSignUpPage({ searchParams }: Props) {
  requireAccounts();
  const q = await searchParams;
  return (
    <>
      <h1>Create an account</h1>
      {q.sent === '1' && (
        <div role="status" className="takeaway">
          <p>Check your email to continue.</p>
        </div>
      )}
      {q.under13 === '1' && (
        <div role="status" className="takeaway">
          <p>
            Accounts start at 13, so we have not created one and we kept nothing you entered. Younger children can
            still take part through a child profile that a parent or guardian sets up. That is coming later.
          </p>
        </div>
      )}
      {q.parent === '1' && (
        <div role="alert" className="grown-ups" id="parent-error">
          <p>
            At 13 to 15 we need a parent or guardian&apos;s email address, and it must be different from yours. Please
            fill in that field and try again.
          </p>
        </div>
      )}
      {q.invalid === '1' && (
        <div role="alert" className="grown-ups">
          <p>Please check your email address and date of birth and try again.</p>
        </div>
      )}
      <form method="post" action="/account/sign-up/submit/" className="prose admin-form">
        <p>
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" required autoComplete="email" maxLength={254} />
        </p>
        <p>
          <label htmlFor="dob">Date of birth</label>
          <input id="dob" name="dob" type="date" required autoComplete="bday" min="1900-01-01" />
        </p>
        <p>
          <label htmlFor="parent_email">Parent or guardian email (only if you are 13 to 15)</label>
          <input
            id="parent_email"
            name="parent_email"
            type="email"
            autoComplete="off"
            maxLength={254}
            aria-describedby={q.parent === '1' ? 'parent-error' : undefined}
            aria-invalid={q.parent === '1' ? true : undefined}
          />
        </p>
        <button type="submit" className="button">
          Create account
        </button>
      </form>
      <p>
        Already have an account? <Link href="/account/sign-in/">Sign in</Link>.
      </p>
    </>
  );
}
