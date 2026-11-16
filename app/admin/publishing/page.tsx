import Link from 'next/link';
import { listPublishingDays, type PublishingDay } from '@/lib/admin/publishing';
import { requireAdmin } from '@/lib/admin/next';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// "Monday, November 16, 2026" from a YYYY-MM-DD business date (noon UTC keeps the weekday right in any zone).
const dayTitle = (date: string) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );

function DaySection({ day }: { day: PublishingDay }) {
  const headingId = `day-${day.date}`;
  const unlisted = day.publishedTotal - day.published.length;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{dayTitle(day.date)}</h2>
      {day.source === 'import' && (
        <p className="muted">From the item imports — no reviewer report was recorded for this day, so held-back items are not listed.</p>
      )}
      <h3>Published ({day.publishedTotal})</h3>
      {day.publishedTotal === 0 && <p>Nothing was published.</p>}
      <ul className="admin-list">
        {day.published.map((p, i) => (
          <li key={`${p.world}-${p.slug ?? p.title}-${i}`}>
            {p.slug ? <Link href={`/${p.world}/${p.slug}/`}>{p.title}</Link> : p.title}
            <br />
            <span className="muted">
              {p.world} · {p.kind}
            </span>
          </li>
        ))}
      </ul>
      {unlisted > 0 && <p className="muted">…and {unlisted} more (bulk import day; see Items for the full list).</p>}
      <h3>Facebook digest post</h3>
      {day.digestPostUrl ? (
        <p>
          <a href={day.digestPostUrl} target="_blank" rel="noreferrer">
            View the digest post on Facebook
          </a>
        </p>
      ) : day.digestExternalId ? (
        <p className="muted">Posted (post id {day.digestExternalId}); no link was recorded.</p>
      ) : (
        <p className="muted">No digest post recorded for this day.</p>
      )}
      <h3>Held back ({day.rejections.length})</h3>
      {day.rejections.length === 0 && <p className="muted">None recorded.</p>}
      <ul className="admin-list">
        {day.rejections.map((r, i) => (
          <li key={`${r.title}-${i}`}>
            {r.title}
            <br />
            <span className="muted">
              {[r.world, r.kind].filter(Boolean).join(' · ')}
              {[r.world, r.kind].filter(Boolean).length > 0 ? ' — ' : ''}
              {r.reason}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function AdminPublishingPage() {
  await requireAdmin();
  const days = await listPublishingDays(getDb());
  return (
    <>
      <h1>Publishing</h1>
      <p className="muted">
        What the daily automation posted, day by day: the items that went live (each links to its page), the items the reviewer held back and why,
        and the Facebook digest post that announced the batch.
      </p>
      {days.length === 0 && <p>Nothing has been published yet.</p>}
      {days.map((d) => (
        <DaySection key={d.date} day={d} />
      ))}
    </>
  );
}
