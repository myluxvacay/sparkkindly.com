import ActionForm from '@/components/admin/ActionForm';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { listWorldsAdmin } from '@/lib/admin/queries';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string }> };
const BACK = '/admin/worlds/';

export default async function AdminWorldsPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  const { done, error } = await searchParams;
  const worlds = await listWorldsAdmin(getDb());
  return (
    <>
      <h1>Worlds</h1>
      <StatusNote done={done} error={error} />
      <ul className="admin-list">
        {worlds.map((w) => (
          <li key={w.slug}>
            <h2>{w.name}</h2>
            <p className="muted">
              /{w.slug}/ · {w.enabled ? 'enabled' : 'disabled'} · {w.approvalMode === 'review' ? 'review mode' : 'auto mode'}
            </p>
            <div className="admin-actions">
              <ActionForm csrf={admin.csrf} action="world.enabled" returnTo={BACK} label={w.enabled ? 'Disable' : 'Enable'} ariaLabel={`${w.enabled ? 'Disable' : 'Enable'} ${w.name}`} fields={{ slug: w.slug, enabled: String(!w.enabled) }} />
              {w.slug !== 'kids' && (
                <ActionForm
                  csrf={admin.csrf}
                  action="world.mode"
                  returnTo={BACK}
                  label={w.approvalMode === 'review' ? 'Switch to auto' : 'Switch to review'}
                  ariaLabel={`${w.approvalMode === 'review' ? 'Switch to auto' : 'Switch to review'}: ${w.name}`}
                  fields={{ slug: w.slug, mode: w.approvalMode === 'review' ? 'auto' : 'review' }}
                  plain
                />
              )}
            </div>
            <details>
              <summary>Edit {w.name}</summary>
              <form method="post" action="/admin/act/" className="admin-form">
                <input type="hidden" name="csrf" value={admin.csrf} />
                <input type="hidden" name="action" value="world.update" />
                <input type="hidden" name="return" value={BACK} />
                <input type="hidden" name="slug" value={w.slug} />
                <p>
                  <label htmlFor={`name-${w.slug}`}>Name</label>
                  <input id={`name-${w.slug}`} name="name" defaultValue={w.name} required maxLength={60} />
                </p>
                <p>
                  <label htmlFor={`promise-${w.slug}`}>Promise</label>
                  <input id={`promise-${w.slug}`} name="promise" defaultValue={w.promise ?? ''} maxLength={120} />
                </p>
                <p>
                  <label htmlFor={`description-${w.slug}`}>Description</label>
                  <textarea id={`description-${w.slug}`} name="description" defaultValue={w.description ?? ''} maxLength={500} rows={3} />
                </p>
                <button type="submit" className="button">
                  Save {w.name}
                </button>
              </form>
            </details>
          </li>
        ))}
      </ul>
      <section aria-labelledby="new-world">
        <h2 id="new-world">Add a world</h2>
        <p>A new world starts disabled and in review mode. Its agent, goals file and key come next.</p>
        <form method="post" action="/admin/act/" className="admin-form">
          <input type="hidden" name="csrf" value={admin.csrf} />
          <input type="hidden" name="action" value="world.create" />
          <input type="hidden" name="return" value={BACK} />
          <p>
            <label htmlFor="new-slug">Address (lowercase letters, digits and hyphens)</label>
            <input id="new-slug" name="slug" required maxLength={30} />
          </p>
          <p>
            <label htmlFor="new-name">Name</label>
            <input id="new-name" name="name" required maxLength={60} />
          </p>
          <button type="submit" className="button">
            Add world
          </button>
        </form>
      </section>
    </>
  );
}
