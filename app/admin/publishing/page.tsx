import Link from 'next/link';
import { listPublishingGrid, type PublishingDayMeta } from '@/lib/admin/publishing';
import { requireAdmin } from '@/lib/admin/next';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom range' },
];
const WORLDS = ['', 'play', 'discover', 'together', 'grow', 'save', 'kids'];
const KINDS = ['', 'article', 'activity', 'video', 'quiz'];
const STATUSES = [
  { value: '', label: 'any' },
  { value: 'published', label: 'Published' },
  { value: 'held', label: 'Held back' },
];

type Props = {
  searchParams: Promise<{ world?: string; kind?: string; status?: string; q?: string; range?: string; from?: string; to?: string }>;
};

// "Nov 16, 2026" from a YYYY-MM-DD business date (noon UTC keeps the weekday right in any zone).
const shortDate = (date: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );

// One compact line per day that has something beyond its rows: the batch's Facebook digest post, a note for
// pre-report import days, the overflow count on bulk days, and a trace for a reported day whose batch has no
// rows in the current view (an empty report, or filters that exclude all of it).
function DayNotes({ days }: { days: PublishingDayMeta[] }) {
  const noted = days.filter(
    (d) => d.digestPostUrl || d.digestExternalId || d.source === 'import' || d.unlisted > 0 || (d.source === 'report' && d.rowCount === 0),
  );
  if (noted.length === 0) return null;
  return (
    <div>
      {noted.map((d) => (
        <p key={d.date} className="muted">
          {shortDate(d.date)} —{' '}
          {d.digestPostUrl ? (
            <>
              Facebook digest: <a href={d.digestPostUrl} target="_blank" rel="noreferrer">View the digest post on Facebook</a>.{' '}
            </>
          ) : d.digestExternalId ? (
            <>Facebook digest posted (post id {d.digestExternalId}); no link was recorded. </>
          ) : null}
          {d.source === 'import' && <>Import day — no reviewer report was recorded, so held-back items are not listed. </>}
          {d.source === 'report' && d.rowCount === 0 && <>A batch was reported for this day; no items from it are in this view. </>}
          {d.unlisted > 0 && <>{d.unlisted} more published items from this day not listed; see Items for the full list.</>}
        </p>
      ))}
    </div>
  );
}

export default async function AdminPublishingPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  void admin;
  const { world, kind, status, q, range, from, to } = await searchParams;
  const grid = await listPublishingGrid(getDb(), { world, kind, status, q, range, from, to });
  const filtered = Boolean(world || kind || status || q || grid.range === 'custom');
  const windowLabel =
    grid.range === 'all'
      ? 'All days'
      : grid.range === 'custom'
        ? `Custom range (${grid.window.from ? shortDate(grid.window.from) : 'any'} – ${grid.window.to ? shortDate(grid.window.to) : 'any'})`
        : `${grid.range === '30' ? 'Last 30 days' : 'Last 7 days'} (${grid.window.from ? shortDate(grid.window.from) : ''} – ${grid.window.to ? shortDate(grid.window.to) : ''})`;
  return (
    <>
      <h1>Publishing</h1>
      <p className="muted">
        What the daily automation posted: every item that went live (each links to its page) and every item the reviewer held back, with the
        reason. Newest first; the last 7 days load by default — widen the range for older batches.
      </p>
      <form method="get" className="admin-form admin-filter">
        <p>
          <label htmlFor="range">Range</label>
          <select id="range" name="range" defaultValue={grid.range}>
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor="from">From (custom range)</label>
          <input id="from" name="from" type="date" defaultValue={from ?? ''} />
        </p>
        <p>
          <label htmlFor="to">To (custom range)</label>
          <input id="to" name="to" type="date" defaultValue={to ?? ''} />
        </p>
        <p>
          <label htmlFor="world">World</label>
          <select id="world" name="world" defaultValue={world ?? ''}>
            {WORLDS.map((w) => (
              <option key={w} value={w}>
                {w || 'any'}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor="kind">Type</label>
          <select id="kind" name="kind" defaultValue={kind ?? ''}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k || 'any'}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status ?? ''}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor="q">Title contains</label>
          <input id="q" name="q" type="search" defaultValue={q ?? ''} maxLength={100} />
        </p>
        <button type="submit" className="button">
          Filter
        </button>
      </form>
      {grid.total > 0 && (
        <p className="muted">
          {windowLabel} · {grid.total} {grid.total === 1 ? 'item' : 'items'} — {grid.publishedCount} published, {grid.heldCount} held back.
          {grid.rows.length < grid.total && <> Showing the first {grid.rows.length}; narrow the filters to see the rest.</>}
        </p>
      )}
      <DayNotes days={grid.days} />
      {grid.total > 0 && (
        <div className="admin-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">World</th>
                <th scope="col">Type</th>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((r, i) => (
                <tr key={`${r.date}-${r.status}-${r.slug ?? r.title}-${i}`}>
                  <td>{shortDate(r.date)}</td>
                  <td>{r.world ?? '—'}</td>
                  <td>{r.kind ?? '—'}</td>
                  <td>{r.slug && r.world ? <Link href={`/${r.world}/${r.slug}/`}>{r.title}</Link> : r.title}</td>
                  <td>{r.status === 'published' ? 'Published' : 'Held back'}</td>
                  <td>{r.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {grid.total === 0 &&
        (filtered ? (
          <p>No items match these filters.</p>
        ) : grid.range === 'all' ? (
          <p>Nothing has been recorded yet. Batches will appear here as the daily jobs report in.</p>
        ) : (
          <p>
            Nothing to show for this range yet. Batches will appear here as the daily jobs report in — widen the range above to see older
            batches.
          </p>
        ))}
    </>
  );
}
