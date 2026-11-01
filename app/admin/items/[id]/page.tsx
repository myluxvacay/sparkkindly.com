import Link from 'next/link';
import { notFound } from 'next/navigation';
import ActionForm from '@/components/admin/ActionForm';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { getItemDetail } from '@/lib/admin/queries';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string }> };
const when = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—');

export default async function AdminItemPage({ params, searchParams }: Props) {
  const admin = await requireAdmin();
  const { id } = await params;
  const { done, error } = await searchParams;
  const detail = await getItemDetail(getDb(), id);
  if (!detail) notFound();
  const { item, world, revisions, reports } = detail;
  const here = `/admin/items/${item.id}/`;
  const f = { id: item.id };
  return (
    <>
      <p className="eyebrow">ITEM</p>
      <h1>{item.title}</h1>
      <StatusNote done={done} error={error} />
      <dl className="admin-facts">
        <dt>World</dt>
        <dd>{world}</dd>
        <dt>Kind</dt>
        <dd>{item.kind}</dd>
        <dt>Status</dt>
        <dd>{item.status}</dd>
        <dt>Audience and tier</dt>
        <dd>
          {item.audience} · {item.riskTier}
        </dd>
        <dt>Publish at</dt>
        <dd>{when(item.publishAt)}</dd>
        <dt>Published</dt>
        <dd>{when(item.publishedAt)}</dd>
        <dt>Created by</dt>
        <dd>{item.createdBy}</dd>
        <dt>Approved by</dt>
        <dd>{item.approvedBy ?? '—'}</dd>
      </dl>
      {item.status === 'published' && (
        <p>
          <Link href={`/${world}/${item.slug}/`}>Open the public page</Link>
        </p>
      )}
      <div className="admin-actions">
        {item.status === 'in_review' && (
          <>
            <ActionForm csrf={admin.csrf} action="item.approve" returnTo={here} label="Approve" fields={f} />
            <ActionForm csrf={admin.csrf} action="item.reject" returnTo={here} label="Reject" fields={f} plain />
          </>
        )}
        {(item.status === 'published' || item.status === 'scheduled') && (
          <ActionForm csrf={admin.csrf} action="item.unpublish" returnTo={here} label="Unpublish" fields={f} />
        )}
      </div>

      <section aria-labelledby="edit">
        <h2 id="edit">Correct the title or summary</h2>
        <form method="post" action="/admin/act/" className="admin-form">
          <input type="hidden" name="csrf" value={admin.csrf} />
          <input type="hidden" name="action" value="item.edit" />
          <input type="hidden" name="return" value={here} />
          <input type="hidden" name="id" value={item.id} />
          <p>
            <label htmlFor="title">Title</label>
            <input id="title" name="title" defaultValue={item.title} required maxLength={140} />
          </p>
          <p>
            <label htmlFor="summary">Summary</label>
            <textarea id="summary" name="summary" defaultValue={item.summary} required maxLength={300} rows={3} />
          </p>
          <p>
            <label htmlFor="reason">Why (kept with the revision)</label>
            <input id="reason" name="reason" required maxLength={200} />
          </p>
          <button type="submit" className="button">
            Save
          </button>
        </form>
      </section>

      <section aria-labelledby="reports">
        <h2 id="reports">Problem reports ({reports.length})</h2>
        <ul>
          {reports.map((r) => (
            <li key={r.id}>
              {r.reason} · {r.status} · {when(r.createdAt)}: {r.message || '(no message)'}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="quality">
        <h2 id="quality">Quality report</h2>
        <pre className="admin-pre">{JSON.stringify(item.qualityReport, null, 2)}</pre>
      </section>

      <section aria-labelledby="revisions">
        <h2 id="revisions">Revisions (newest first, 10 kept)</h2>
        <ol>
          {revisions.map((r) => (
            <li key={r.revision}>
              #{r.revision} · {when(r.createdAt)} · {r.changedBy} · {r.reason ?? ''}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
