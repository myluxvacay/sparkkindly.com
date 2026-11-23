import Link from 'next/link';
import Breadcrumb from '@/components/Breadcrumb';
import { metadata as seo } from '@/lib/seo';
import { MAX_REQUEST_TEXT } from '@/lib/requests/submit';
import { REQUEST_AGE_BANDS, REQUEST_CATEGORIES } from '@/lib/requests/types';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return seo(
    'Request a Printable',
    'Can\'t find the printable you want? Tell SparkKindly what to create — pick a category, an age band, and describe the sheet. The most-requested ideas get made first.',
    '/printables/request/',
  );
}

type Props = {
  searchParams: Promise<{ sent?: string; error?: string; category?: string; age?: string; text?: string }>;
};

// Request-a-Creation (owner direction, 23 November 2026): a family or teacher who cannot find the
// sheet they want asks for it here. The form deliberately has NO name and NO email field — nothing
// personal is collected, ever. Requests are reviewed by the SparkKindly team before anything shows
// anywhere; approved ones appear on the Fresh Requests shelf, and the most-requested get made first.
export default async function RequestPrintablePage({ searchParams }: Props) {
  const sp = await searchParams;
  const category = REQUEST_CATEGORIES.some((c) => c.topic === sp.category) ? sp.category : '';
  const age = REQUEST_AGE_BANDS.some((a) => a.topic === sp.age) ? sp.age : '';
  const text = (sp.text ?? '').slice(0, MAX_REQUEST_TEXT);
  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: 'Printables', href: '/printables/' }, { name: 'Request a printable' }]} />
      <p className="eyebrow">CAN&apos;T FIND IT? REQUEST IT</p>
      <h1>Request a printable</h1>
      <p className="intro-text">
        Looking for a counting sheet with dinosaurs, a poster about volcanoes, a maze shaped like a castle?
        Tell us what to create. Requests are read and reviewed by the SparkKindly team, the approved ones appear
        on the <Link href="/printables/fresh-requests/">Fresh Requests shelf</Link>, and the most-requested
        sheets get made first.
      </p>
      {sp.sent === '1' && (
        <div role="status" id="result" tabIndex={-1} className="takeaway">
          <p>
            Thank you — your request is with the team for review. We don&apos;t send replies, so check the{' '}
            <Link href="/printables/fresh-requests/">Fresh Requests shelf</Link> to see it once it&apos;s approved,
            and watch for it to be marked <strong>Made!</strong>
          </p>
        </div>
      )}
      {sp.error === '1' && (
        <div role="alert" id="result" tabIndex={-1} className="grown-ups">
          <p>
            Your request was not saved. Please pick a category and an age band, and describe what you&apos;d like in
            plain text (up to {MAX_REQUEST_TEXT} characters, no web addresses or code, please).
          </p>
        </div>
      )}
      <form method="post" action="/printables/request/submit/" className="quiz-form">
        <p>
          <label htmlFor="category">Which collection should it join?</label>
          <br />
          <select id="category" name="category" required defaultValue={category} style={{ font: 'inherit' }}>
            <option value="" disabled>
              Choose a category…
            </option>
            {REQUEST_CATEGORIES.map((c) => (
              <option key={c.topic} value={c.topic}>
                {c.name}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor="age">Who is it for?</label>
          <br />
          <select id="age" name="age" required defaultValue={age} style={{ font: 'inherit' }}>
            <option value="" disabled>
              Choose an age band…
            </option>
            {REQUEST_AGE_BANDS.map((a) => (
              <option key={a.topic} value={a.topic}>
                {a.label}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor="text">What would you like us to create? (up to {MAX_REQUEST_TEXT} characters)</label>
          <br />
          <textarea
            id="text"
            name="text"
            rows={4}
            required
            maxLength={MAX_REQUEST_TEXT}
            defaultValue={text}
            placeholder="e.g. A counting sheet with dinosaurs, numbers to 20"
            style={{ width: '100%', font: 'inherit' }}
          />
        </p>
        <p className="muted">
          This form is for grown-ups — parents, carers and teachers. Please don&apos;t include a child&apos;s name or
          any personal details: we don&apos;t ask for your name or email, and we can&apos;t reply. Every request is
          reviewed by a person before it appears anywhere.
        </p>
        {/* Honeypot: hidden from people and assistive technology; a bot that fills it is silently ignored. */}
        <div hidden>
          <label htmlFor="website">Leave this empty</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>
        <button type="submit" className="button">
          Send request
        </button>
      </form>
    </div>
  );
}
