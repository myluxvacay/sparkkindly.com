import Link from 'next/link';
import Breadcrumb from '@/components/Breadcrumb';
import { getDb } from '@/lib/db';
import { metadata as seo } from '@/lib/seo';
import { listPublicRequests } from '@/lib/requests/repo';
import { requestAgeLabel, requestCategoryName } from '@/lib/requests/types';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return seo(
    'Fresh Requests',
    'Printables families and teachers asked SparkKindly to create — approved by our team, open for "me too" votes, and marked Made! when the sheet is published.',
    '/printables/fresh-requests/',
  );
}

type Props = { searchParams: Promise<{ voted?: string }> };

// The Fresh Requests shelf (owner direction, 23 November 2026): the public half of Request-a-
// Creation. Only requests a reviewer has approved appear here — pending and declined requests are
// never selected by the read behind this page. A "Me too" is one anonymous vote per visitor
// (deduped by a server-side hash, no browser storage, no accounts); the counts steer what gets
// made first. Fulfilled requests stay up as "Made!", linking the published sheet.
export default async function FreshRequestsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const requests = await listPublicRequests(getDb());
  const waiting = requests.filter((r) => r.status === 'approved');
  const made = requests.filter((r) => r.status === 'created');
  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: 'Printables', href: '/printables/' }, { name: 'Fresh Requests' }]} />
      <p className="eyebrow">ASKED FOR BY FAMILIES</p>
      <h1>Fresh Requests</h1>
      <p className="intro-text">
        These are the printables parents, carers and teachers asked us to create. Every one was reviewed by the
        SparkKindly team before it appeared here. Tap <strong>Me too</strong> on the ones your family wants — the
        most-requested sheets get made first. Can&apos;t see yours?{' '}
        <Link href="/printables/request/">Request a printable</Link>.
      </p>
      {sp.voted === '1' && (
        <div role="status" id="result" tabIndex={-1} className="takeaway">
          <p>Thanks — your vote is counted. One vote per family per request, so every count is a real family asking.</p>
        </div>
      )}
      {waiting.length === 0 && made.length === 0 && (
        <p>No requests on the shelf yet — be the first to <Link href="/printables/request/">ask for a printable</Link>.</p>
      )}
      {waiting.length > 0 && (
        <>
          <h2>Waiting to be made</h2>
          <div className="card-list">
            {waiting.map((r) => (
              <article key={r.id} id={`request-${r.id}`} className="card">
                <p className="printable-card-cat">
                  {requestCategoryName(r.categoryTopic)} · {requestAgeLabel(r.ageTopic)}
                </p>
                <p>{r.requestText}</p>
                <form method="post" action="/printables/fresh-requests/me-too/" className="admin-inline">
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className="button">
                    Me too{r.meTooCount > 0 ? ` · ${r.meTooCount}` : ''}
                  </button>
                </form>
              </article>
            ))}
          </div>
        </>
      )}
      {made.length > 0 && (
        <>
          <h2>Made!</h2>
          <div className="card-list">
            {made.map((r) => (
              <article key={r.id} id={`request-${r.id}`} className="card">
                <p className="printable-card-cat">
                  {requestCategoryName(r.categoryTopic)} · {requestAgeLabel(r.ageTopic)}
                </p>
                <p>{r.requestText}</p>
                <p>
                  <strong>Made!</strong>{' '}
                  {r.createdUrl && <Link href={r.createdUrl}>Get the printable →</Link>}
                  {r.meTooCount > 0 ? ` · ${r.meTooCount} ${r.meTooCount === 1 ? 'family' : 'families'} asked` : ''}
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
