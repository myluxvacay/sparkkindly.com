import Link from 'next/link';
import { requireAccounts } from '@/lib/accounts/next';

export const dynamic = 'force-dynamic';

// The screen after the sign-up form (user feedback, 17 Nov 2026): its own page, not a banner over the
// form, so the next steps have room to be clear. It names no address — the sign-up flow never puts an
// email in a URL — and the way back for a lost email is the sign-in form, which sends a fresh link to
// any address that has an account, including a brand-new one (lib/accounts/web.ts emailLink).
export default function SignUpCheckEmailPage() {
  requireAccounts();
  return (
    <>
      <h1>Check your email to continue</h1>
      <div role="status" className="takeaway">
        <p>We have sent a sign-in link to the email address you gave us.</p>
      </div>
      <ol className="prose">
        <li>Open your inbox and find the email from SparkKindly — its subject is “Your SparkKindly sign-in link”.</li>
        <li>
          Choose the link within 15 minutes. It works once: it signs you in and finishes creating your account.
        </li>
        <li>That is all — there is no password to make or remember.</li>
      </ol>
      <h2>If the email does not arrive</h2>
      <ul className="prose">
        <li>Give it a couple of minutes, then look in your spam or junk folder.</li>
        <li>
          Links expire after 15 minutes. If yours has expired, or it never arrives,{' '}
          <Link href="/account/sign-in/">ask for a new link on the sign-in page</Link> — the same form sends a fresh
          one to any address that has an account, including the one you just created.
        </li>
        <li>
          Typed the wrong address? <Link href="/account/sign-up/">Go back and create the account again</Link> with
          the right one.
        </li>
      </ul>
    </>
  );
}
