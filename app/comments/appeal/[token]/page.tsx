import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unsubscribeSecret } from '@/lib/accounts/unsubscribe';
import { appealState } from '@/lib/comments/appeals';
import { commentsEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
// strict-origin: a link on this page never sends the token-bearing URL as a Referer, while form posts keep their Origin.
export const metadata: Metadata = { title: 'Appeal a comment decision', robots: { index: false, follow: false }, referrer: 'strict-origin' };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ a?: string }> };

const OUTCOMES: Record<string, { title: string; text: string }> = {
  filed: { title: 'Your appeal is sent', text: 'The site owner will look at it, usually within 48 hours, and email you the outcome.' },
  duplicate: { title: 'This comment already has an appeal', text: 'Each comment can be appealed once. You will be emailed the outcome.' },
  expired: { title: 'This link has expired', text: 'Appeals can be filed for 30 days after the decision.' },
  invalid: { title: 'This link is not valid', text: 'The link is not valid for an appeal, or the comment can no longer be appealed.' },
};

const Result = ({ title, text }: { title: string; text: string }) => (
  <>
    <h1 id="result" tabIndex={-1}>
      {title}
    </h1>
    <p role="status">{text}</p>
    <p>
      <Link href="/community/guidelines/">Read the community guidelines</Link>
    </p>
  </>
);

// Opening the emailed link only reads (a mail scanner fetching it files nothing); the button posts the appeal.
export default async function AppealPage({ params, searchParams }: Props) {
  if (!commentsEnabled()) notFound();
  const { token } = await params;
  const { a } = await searchParams;
  if (a && Object.hasOwn(OUTCOMES, a)) return <Result {...OUTCOMES[a]} />;
  const state = await appealState(getDb(), unsubscribeSecret(process.env), token, new Date());
  if (state !== 'open') return <Result {...OUTCOMES[state === 'filed' ? 'duplicate' : state]} />;
  return (
    <>
      <h1>Appeal a comment decision</h1>
      <div className="prose">
        <p>
          One of your comments was removed. If you think that was a mistake, tell the site owner why. They will look at
          the comment and the reason it was removed, and email you the outcome.
        </p>
      </div>
      <form method="post" action={`/comments/appeal/${encodeURIComponent(token)}/confirm/`} className="prose admin-form">
        <label htmlFor="appeal-note">Why should it be shown? (optional, up to 300 characters)</label>
        <textarea id="appeal-note" name="note" maxLength={300} rows={4} />
        <button type="submit" className="button">
          Send appeal
        </button>
      </form>
    </>
  );
}
