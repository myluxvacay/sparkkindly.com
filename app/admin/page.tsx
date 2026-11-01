import Link from 'next/link';
import ActionForm from '@/components/admin/ActionForm';
import StatusNote from '@/components/admin/StatusNote';
import { buildDigest } from '@/lib/admin/digest';
import { requireAdmin } from '@/lib/admin/next';
import { listQueue } from '@/lib/admin/queries';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

export default async function AdminQueuePage({ searchParams }: Props) {
  const admin = await requireAdmin();
  const { done, error } = await searchParams;
  const db = getDb();
  const [queue, digest] = await Promise.all([listQueue(db), buildDigest(db, new Date())]);
  return (
    <>
      <h1>Approval queue</h1>
      <StatusNote done={done} error={error} />
      {digest.alerts.length > 0 && (
        <section aria-labelledby="alerts">
          <h2 id="alerts">Alerts</h2>
          <ul>
            {digest.alerts.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="waiting">
        <h2 id="waiting">Waiting for approval ({queue.length})</h2>
        {queue.length === 0 && <p>Nothing is waiting.</p>}
        <ul className="admin-list">
          {queue.map((i) => (
            <li key={i.id}>
              <p>
                <Link href={`/admin/items/${i.id}/`}>{i.title}</Link>
                <br />
                <span className="muted">
                  {i.world} · {i.kind} · audience {i.audience} · tier {i.riskTier} · from {i.createdBy}
                  {i.decision ? ` · ${i.decision}` : ''}
                </span>
              </p>
              <div className="admin-actions">
                <ActionForm csrf={admin.csrf} action="item.approve" returnTo="/admin/" label="Approve" ariaLabel={`Approve: ${i.title}`} fields={{ id: i.id }} />
                <ActionForm csrf={admin.csrf} action="item.reject" returnTo="/admin/" label="Reject" ariaLabel={`Reject: ${i.title}`} fields={{ id: i.id }} plain />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
