import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { listTopicsAdmin } from '@/lib/admin/queries';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string }> };
const BACK = '/admin/topics/';

export default async function AdminTopicsPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  const { done, error } = await searchParams;
  const topics = await listTopicsAdmin(getDb());
  return (
    <>
      <h1>Topics</h1>
      <StatusNote done={done} error={error} />
      <section aria-labelledby="new-topic">
        <h2 id="new-topic">Add a topic</h2>
        <form method="post" action="/admin/act/" className="admin-form">
          <input type="hidden" name="csrf" value={admin.csrf} />
          <input type="hidden" name="action" value="topic.create" />
          <input type="hidden" name="return" value={BACK} />
          <p>
            <label htmlFor="topic-slug">Address (lowercase letters, digits and hyphens)</label>
            <input id="topic-slug" name="slug" required maxLength={80} />
          </p>
          <p>
            <label htmlFor="topic-name">Name</label>
            <input id="topic-name" name="name" required maxLength={60} />
          </p>
          <button type="submit" className="button">
            Add topic
          </button>
        </form>
      </section>
      <section aria-labelledby="all-topics">
        <h2 id="all-topics">All topics ({topics.length})</h2>
        <ul className="admin-list">
          {topics.map((t) => (
            <li key={t.slug}>
              <form method="post" action="/admin/act/" className="admin-inline">
                <input type="hidden" name="csrf" value={admin.csrf} />
                <input type="hidden" name="action" value="topic.rename" />
                <input type="hidden" name="return" value={BACK} />
                <input type="hidden" name="slug" value={t.slug} />
                <label htmlFor={`t-${t.slug}`}>
                  {t.slug} ({t.items} items)
                </label>{' '}
                <input id={`t-${t.slug}`} name="name" defaultValue={t.name} required maxLength={60} />{' '}
                <button type="submit" className="text-button" aria-label={`Rename ${t.slug}`}>
                  Rename
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
