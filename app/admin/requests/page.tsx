import Link from 'next/link';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { getDb } from '@/lib/db';
import { countReportsByStatus, listReportsByStatus, REPORT_STATUSES, type ReportStatus } from '@/lib/reports/repo';
import { reportReasonLabel } from '@/lib/reports/submit';
import { countRequestsByStatus, listRequestsByStatus } from '@/lib/requests/repo';
import { requestAgeLabel, requestCategoryName, REQUEST_STATUSES, type PrintableRequest, type RequestStatus } from '@/lib/requests/types';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string; status?: string; queue?: string; rstatus?: string }> };
const BACK = '/admin/requests/';

// Request-a-Creation + Report-a-Mistake moderation (owner direction, 23 November 2026): one review
// area, two queues. Creation requests land as 'pending' and are invisible everywhere until a
// decision here — approve puts one on the public Fresh Requests shelf, decline keeps it off
// forever, "Mark created" (with the published item's path) turns it into the shelf's "Made!" entry.
// Mistake reports are the sibling queue: they name the item they were filed from, are NEVER shown
// publicly, and end as fixed / not-a-mistake / duplicate. All writes go through /admin/act/ like
// every other admin change, so each decision lands in the audit log with its actor. Neither form
// collects any sender information — there is none to show.
export default async function AdminRequestsPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const queue = sp.queue === 'reports' ? 'reports' : 'requests';
  const db = getDb();

  const tabs = (
    <p role="group" aria-label="Choose a queue">
      <Link href={BACK} aria-current={queue === 'requests' ? 'page' : undefined}>
        Creation requests
      </Link>{' '}
      ·{' '}
      <Link href={`${BACK}?queue=reports`} aria-current={queue === 'reports' ? 'page' : undefined}>
        Mistake reports
      </Link>
    </p>
  );

  if (queue === 'reports') {
    const status: ReportStatus = REPORT_STATUSES.includes(sp.rstatus as ReportStatus) ? (sp.rstatus as ReportStatus) : 'pending';
    const counts = await countReportsByStatus(db);
    const reports = await listReportsByStatus(db, status);
    const decideForm = (id: string, action: string, label: string) => (
      <form method="post" action="/admin/act/" className="admin-inline">
        <input type="hidden" name="csrf" value={admin.csrf} />
        <input type="hidden" name="action" value={action} />
        <input type="hidden" name="return" value={`${BACK}?queue=reports&rstatus=${status}`} />
        <input type="hidden" name="id" value={id} />
        <button type="submit" className="text-button">
          {label}
        </button>
      </form>
    );
    return (
      <>
        <h1>Requests &amp; reports</h1>
        <StatusNote done={sp.done} error={sp.error} />
        {tabs}
        <p className="muted">
          Mistake reports filed from item pages. A report is never shown publicly; it names the item it came from so
          you can check the page yourself. The sender is not recorded anywhere.
        </p>
        <p role="group" aria-label="Filter by status">
          {REPORT_STATUSES.map((s) => (
            <span key={s}>
              <Link href={`${BACK}?queue=reports&rstatus=${s}`} aria-current={s === status ? 'page' : undefined}>
                {s} ({counts[s]})
              </Link>{' '}
            </span>
          ))}
        </p>
        {reports.length === 0 && <p>No {status} reports.</p>}
        {reports.map((r) => (
          <article key={r.id} className="card">
            <p className="printable-card-cat">
              {reportReasonLabel(r.reason)} · {r.createdAt.toISOString().slice(0, 10)} ·{' '}
              <Link href={`/admin/items/${r.itemId}/`}>{r.itemTitle}</Link> ({r.world})
            </p>
            <p>{r.message || '(no message)'}</p>
            {r.status === 'pending' && (
              <p>
                {decideForm(r.id, 'report.fixed', 'Mark fixed')} {decideForm(r.id, 'report.not-a-mistake', 'Not a mistake')}{' '}
                {decideForm(r.id, 'report.duplicate', 'Duplicate')}
              </p>
            )}
          </article>
        ))}
      </>
    );
  }

  const status: RequestStatus = REQUEST_STATUSES.includes(sp.status as RequestStatus) ? (sp.status as RequestStatus) : 'pending';
  const counts = await countRequestsByStatus(db);
  const requests = await listRequestsByStatus(db, status);

  const actForm = (r: PrintableRequest, action: string, label: string, withUrl = false) => (
    <form method="post" action="/admin/act/" className="admin-inline">
      <input type="hidden" name="csrf" value={admin.csrf} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="return" value={`${BACK}?status=${status}`} />
      <input type="hidden" name="id" value={r.id} />
      {withUrl && (
        <input name="created_url" required maxLength={300} placeholder="/printables/…/" aria-label="Published item path" style={{ font: 'inherit' }} />
      )}{' '}
      <button type="submit" className="text-button">
        {label}
      </button>
    </form>
  );

  return (
    <>
      <h1>Requests &amp; reports</h1>
      <StatusNote done={sp.done} error={sp.error} />
      {tabs}
      <p className="muted">
        Requests from the public <Link href="/printables/request/">request form</Link>. Nothing a visitor submits is
        visible anywhere until you approve it; approved requests appear on the{' '}
        <Link href="/printables/fresh-requests/">Fresh Requests shelf</Link> with their me-too counts. There is no
        sender information to see — the form collects none.
      </p>
      <p role="group" aria-label="Filter by status">
        {REQUEST_STATUSES.map((s) => (
          <span key={s}>
            <Link href={`${BACK}?status=${s}`} aria-current={s === status ? 'page' : undefined}>
              {s[0].toUpperCase() + s.slice(1)} ({counts[s]})
            </Link>{' '}
          </span>
        ))}
      </p>
      {requests.length === 0 && <p>No {status} requests.</p>}
      {requests.map((r) => (
        <article key={r.id} className="card">
          <p className="printable-card-cat">
            {requestCategoryName(r.categoryTopic)} · {requestAgeLabel(r.ageTopic)} · me too: {r.meTooCount} ·{' '}
            {r.createdAt.toISOString().slice(0, 10)}
          </p>
          <p>{r.requestText}</p>
          {r.status === 'created' && r.createdUrl && (
            <p>
              Made: <Link href={r.createdUrl}>{r.createdUrl}</Link>
            </p>
          )}
          <p>
            {r.status === 'pending' && actForm(r, 'request.approve', 'Approve')}
            {(r.status === 'pending' || r.status === 'approved') && actForm(r, 'request.decline', 'Decline')}
            {(r.status === 'pending' || r.status === 'approved') && actForm(r, 'request.create', 'Mark created', true)}
          </p>
        </article>
      ))}
    </>
  );
}
