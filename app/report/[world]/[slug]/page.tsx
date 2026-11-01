import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { anonymousScope } from '@/lib/public/scope';
import { getPublicItem } from '@/lib/public/reads';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Report a problem', robots: { index: false, follow: false } };

const REASONS: [string, string][] = [
  ['wrong', 'Something is wrong or out of date'],
  ['unsafe', 'Something is unsafe or unsuitable'],
  ['broken', 'Something is broken'],
  ['other', 'Something else'],
];

type Props = { params: Promise<{ world: string; slug: string }>; searchParams: Promise<{ sent?: string; error?: string }> };

export default async function ReportPage({ params, searchParams }: Props) {
  const { world, slug } = await params;
  const { sent, error } = await searchParams;
  const item = await getPublicItem(getDb(), anonymousScope(), world, slug);
  if (!item) notFound();
  const itemPath = `/${encodeURIComponent(world)}/${encodeURIComponent(slug)}/`;
  const action = `/report/${encodeURIComponent(world)}/${encodeURIComponent(slug)}/submit/`;

  return (
    <div className="container trust-page">
      <p className="eyebrow">REPORT A PROBLEM</p>
      <h1>Tell us what is wrong.</h1>
      <p className="intro-text">
        About: <Link href={itemPath}>{item.title}</Link>
      </p>
      {sent === '1' && (
        <div role="status" className="takeaway">
          <p>Thank you. Your report was received and will be read.</p>
        </div>
      )}
      {error === '1' && (
        <div role="alert" className="grown-ups">
          <p>Your report was not sent. Please choose a reason and keep the message under 1000 characters.</p>
        </div>
      )}
      <form method="post" action={action} className="prose quiz-form">
        <fieldset>
          <legend>What kind of problem is it?</legend>
          <div className="options">
            {REASONS.map(([value, label], i) => (
              <label key={value} className="option">
                <input type="radio" name="reason" value={value} required defaultChecked={i === 0} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <p>
          <label htmlFor="message">Anything else we should know? (optional, up to 1000 characters)</label>
          <br />
          <textarea id="message" name="message" rows={5} maxLength={1000} style={{ width: '100%', font: 'inherit' }} />
        </p>
        <p className="muted">Please do not include names or other personal details. We do not record who sends a report.</p>
        {/* Honeypot: hidden from people and assistive technology; a bot that fills it is silently ignored. */}
        <div hidden>
          <label htmlFor="website">Leave this empty</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>
        <button type="submit" className="button">
          Send report
        </button>
      </form>
    </div>
  );
}
