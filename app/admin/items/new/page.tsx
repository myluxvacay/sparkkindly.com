import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { listWorldsAdmin } from '@/lib/admin/queries';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

export default async function AdminNewItemPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  const { done, error } = await searchParams;
  const worlds = await listWorldsAdmin(getDb());
  return (
    <>
      <h1>Write an article</h1>
      <StatusNote done={done} error={error} />
      <p>It is published at once, with you as its approver. In the Kids world it is always Kids content.</p>
      <form method="post" action="/admin/act/" className="admin-form">
        <input type="hidden" name="csrf" value={admin.csrf} />
        <input type="hidden" name="action" value="item.create" />
        <input type="hidden" name="return" value="/admin/items/new/" />
        <p>
          <label htmlFor="world">World</label>
          <select id="world" name="world" required>
            {worlds.map((w) => (
              <option key={w.slug} value={w.slug}>
                {w.name}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor="title">Title</label>
          <input id="title" name="title" required maxLength={140} />
        </p>
        <p>
          <label htmlFor="slug">Address (lowercase letters, digits and hyphens)</label>
          <input id="slug" name="slug" required pattern="[a-z0-9-]{3,80}" maxLength={80} />
        </p>
        <p>
          <label htmlFor="summary">Summary</label>
          <textarea id="summary" name="summary" required maxLength={300} rows={3} />
        </p>
        <p>
          <label htmlFor="body">Text (a blank line starts a new paragraph)</label>
          <textarea id="body" name="body" required maxLength={20000} rows={12} />
        </p>
        <fieldset>
          <legend>Audience</legend>
          {[
            ['all', 'Everyone'],
            ['adults', 'Aimed at adults'],
            ['kids', 'Kids'],
          ].map(([value, label], i) => (
            <label key={value} className="admin-radio">
              <input type="radio" name="audience" value={value} defaultChecked={i === 0} /> {label}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="button">
          Publish
        </button>
      </form>
    </>
  );
}
