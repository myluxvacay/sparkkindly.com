import Link from 'next/link';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { listItems } from '@/lib/admin/queries';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STATUSES = ['', 'draft', 'in_review', 'scheduled', 'published', 'rejected', 'archived'];
type Props = { searchParams: Promise<{ status?: string; q?: string; done?: string; error?: string }> };

export default async function AdminItemsPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  const { status, q, done, error } = await searchParams;
  const items = await listItems(getDb(), { status, q });
  return (
    <>
      <h1>Items</h1>
      <StatusNote done={done} error={error} />
      <p>
        <Link href="/admin/items/new/">Write a new article</Link> <span className="muted">(signed in as {admin.email})</span>
      </p>
      <form method="get" className="admin-form admin-filter">
        <p>
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status ?? ''}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || 'any'}
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
      <div className="admin-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">World</th>
              <th scope="col">Kind</th>
              <th scope="col">Status</th>
              <th scope="col">Publish at</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link href={`/admin/items/${i.id}/`}>{i.title}</Link>
                </td>
                <td>{i.world}</td>
                <td>{i.kind}</td>
                <td>{i.status}</td>
                <td>{i.publishAt ? new Date(i.publishAt).toISOString().slice(0, 16).replace('T', ' ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length === 0 && <p>No items match.</p>}
    </>
  );
}
