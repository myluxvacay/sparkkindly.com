import ActionForm from '@/components/admin/ActionForm';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { listReportedCircles } from '@/lib/circles/reports';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string }> };
const RETURN = '/admin/circles/';
const when = (d: Date) => new Date(d).toISOString().slice(0, 16).replace('T', ' ');

// Reported circles (plan 4D): counts, the latest reason and note, hide or restore, mark handled. No member names or
// addresses are read for this page.
export default async function AdminCirclesPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  const { done, error } = await searchParams;
  const circles = await listReportedCircles(getDb());
  return (
    <>
      <h1>Reported circles</h1>
      <StatusNote done={done} error={error} />
      {circles.length === 0 && <p>No circle has been reported.</p>}
      <ul className="admin-list">
        {circles.map((c) => (
          <li key={c.id}>
            <p>
              <strong>{c.name}</strong>{' '}
              <span className="muted">
                ({c.kind}, {c.status}
                {c.hidden ? ', hidden' : ''}, {c.members} members)
              </span>
              <br />
              {c.open} open of {c.total} reports · latest: {c.latestReason}, {when(c.latestAt)} UTC
            </p>
            <p className="admin-message">{c.latestNote || '(no note)'}</p>
            <div className="admin-actions">
              {c.hidden ? (
                <ActionForm csrf={admin.csrf} action="circle.restore" returnTo={RETURN} label="Restore circle" ariaLabel={`Restore: ${c.name}`} fields={{ id: c.id }} />
              ) : (
                <ActionForm csrf={admin.csrf} action="circle.hide" returnTo={RETURN} label="Hide circle" ariaLabel={`Hide: ${c.name}`} fields={{ id: c.id }} />
              )}
              {c.open > 0 && (
                <ActionForm csrf={admin.csrf} action="circle.reports_handled" returnTo={RETURN} label="Mark reports handled" ariaLabel={`Mark reports handled: ${c.name}`} fields={{ id: c.id }} plain />
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
