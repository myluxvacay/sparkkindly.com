import Link from 'next/link';
import ActionForm from '@/components/admin/ActionForm';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { listReports } from '@/lib/admin/queries';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

export default async function AdminReportsPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  const { done, error } = await searchParams;
  const reports = await listReports(getDb());
  return (
    <>
      <h1>Problem reports</h1>
      <StatusNote done={done} error={error} />
      {reports.length === 0 && <p>No open reports.</p>}
      <ul className="admin-list">
        {reports.map((r) => (
          <li key={r.id}>
            <p>
              <Link href={`/admin/items/${r.itemId}/`}>{r.title}</Link> <span className="muted">({r.world}, {r.itemStatus})</span>
              <br />
              <strong>{r.reason}</strong> · {new Date(r.createdAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
            </p>
            <p className="admin-message">{r.message || '(no message)'}</p>
            <details>
              <summary>Quality report</summary>
              <pre className="admin-pre">{JSON.stringify(r.qualityReport, null, 2)}</pre>
            </details>
            <div className="admin-actions">
              <ActionForm csrf={admin.csrf} action="report.close" returnTo="/admin/reports/" label="Close report" ariaLabel={`Close report on: ${r.title}`} fields={{ id: r.id }} />
              {r.itemStatus === 'published' && (
                <ActionForm csrf={admin.csrf} action="item.unpublish" returnTo="/admin/reports/" label="Unpublish item" ariaLabel={`Unpublish: ${r.title}`} fields={{ id: r.itemId }} plain />
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
