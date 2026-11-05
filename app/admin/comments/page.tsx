import { notFound } from 'next/navigation';
import ActionForm from '@/components/admin/ActionForm';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { commentSwitches, trustByComment } from '@/lib/comments/admin';
import { commentsEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string; comment?: string }> };
const RETURN = '/admin/comments/';

// Comment switches and trust (plan 7A): per-world switches (Kids is never offered: its items never carry comments), a
// per-item switch by path, and an account's trust found through one of its comments. No email or account id is shown.
export default async function AdminCommentsPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  if (!commentsEnabled()) notFound();
  const { done, error, comment } = await searchParams;
  const db = getDb();
  const switches = await commentSwitches(db);
  const trust = comment ? await trustByComment(db, comment) : null;
  return (
    <>
      <h1>Comments</h1>
      <StatusNote done={done} error={error} />
      <h2>Worlds</h2>
      <p>Comments are never offered on Kids items.</p>
      <ul className="admin-list">
        {switches.worlds.map((w) => (
          <li key={w.slug}>
            <strong>{w.name}</strong>: comments {w.enabled ? 'on' : 'off'}{' '}
            <ActionForm
              csrf={admin.csrf}
              action="comments.world_toggle"
              returnTo={RETURN}
              label={w.enabled ? 'Switch off' : 'Switch on'}
              ariaLabel={`${w.enabled ? 'Switch off' : 'Switch on'} comments: ${w.name}`}
              fields={{ slug: w.slug, enabled: String(!w.enabled) }}
              plain
            />
          </li>
        ))}
      </ul>

      <h2>One item</h2>
      <ActionForm csrf={admin.csrf} action="comments.item_toggle" returnTo={RETURN} label="Save item switch">
        <label htmlFor="item-path">Item address (for example /play/some-item/)</label>
        <input id="item-path" name="item" type="text" required />
        <label htmlFor="item-value">Comments on this item</label>
        <select id="item-value" name="value" defaultValue="inherit">
          <option value="inherit">Follow the world</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </ActionForm>
      {switches.items.length > 0 && (
        <ul className="admin-list">
          {switches.items.map((i) => (
            <li key={i.path}>
              {i.title} ({i.path}): comments {i.enabled ? 'on' : 'off'}
            </li>
          ))}
        </ul>
      )}

      <h2>Account trust by comment</h2>
      <form method="get" action={RETURN} className="admin-form">
        <label htmlFor="trust-comment">Comment id or comment link</label>
        <input id="trust-comment" name="comment" type="text" required defaultValue={comment ?? ''} />
        <button type="submit" className="button">
          Look up
        </button>
      </form>
      {comment && !trust && <p>No comment was found for that id or link.</p>}
      {trust && (
        <div>
          <p>
            <strong>{trust.displayName ?? '(no name yet)'}</strong>: level {trust.level}, {trust.approved} approved since the last
            drop, {trust.rejected} rejected{trust.banned ? ', banned' : ''}.
          </p>
          <div className="admin-actions">
            {[0, 1].map((level) => (
              <ActionForm
                key={level}
                csrf={admin.csrf}
                action="comments.trust_set"
                returnTo={`${RETURN}?comment=${trust.comment}`}
                label={`Set level ${level}`}
                fields={{ comment: trust.comment, level: String(level) }}
              />
            ))}
            <ActionForm
              csrf={admin.csrf}
              action="comments.ban"
              returnTo={`${RETURN}?comment=${trust.comment}`}
              label={trust.banned ? 'Lift the ban' : 'Ban from commenting'}
              fields={{ comment: trust.comment, banned: String(!trust.banned) }}
              plain
            />
          </div>
        </div>
      )}
    </>
  );
}
