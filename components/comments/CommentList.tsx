// Published comments with one level of replies (plan 7A), plus the viewer's own held comments marked "Waiting for
// review" in text. Every body is React text: nothing is rendered as HTML, markdown or a link. Names and times only.
import type { CommentSectionData } from '@/lib/comments/web';
import { relativeTime } from '@/lib/comments/web';
import { COMMENT_LIMITS } from '@/lib/comments/rules';
import CommentForm from './CommentForm';

type Entry = {
  id: string;
  parentId: string | null;
  name: string | null;
  body: string;
  createdAt: Date;
  deleted: boolean;
  mine: boolean;
  held: boolean;
};

function entries(data: CommentSectionData): Entry[] {
  const shown = data.comments.map((c) => ({ ...c, name: c.displayName, held: false }));
  const pending = data.pending.map((p) => ({ ...p, name: 'You', deleted: false, mine: true, held: true }));
  return [...shown, ...pending].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function OwnActions({ e, data }: { e: Entry; data: CommentSectionData }) {
  const editable = data.now.getTime() - new Date(e.createdAt).getTime() <= COMMENT_LIMITS.editMs;
  return (
    <div className="admin-actions">
      {editable && (
        <details>
          <summary>Edit</summary>
          <form method="post" action="/comments/edit/" className="admin-form">
            <input type="hidden" name="item" value={data.itemId} />
            <input type="hidden" name="comment" value={e.id} />
            <label htmlFor={`edit-${e.id}`}>Edit your comment (within 15 minutes of posting)</label>
            <textarea id={`edit-${e.id}`} name="body" rows={4} required defaultValue={e.body} />
            <button type="submit" className="button">
              Save
            </button>
          </form>
        </details>
      )}
      <form method="post" action="/comments/delete/" className="admin-action">
        <input type="hidden" name="item" value={data.itemId} />
        <input type="hidden" name="comment" value={e.id} />
        <button type="submit" className="text-button" aria-label="Delete your comment">
          Delete
        </button>
      </form>
    </div>
  );
}

function Comment({ e, replies, data }: { e: Entry; replies: Entry[]; data: CommentSectionData }) {
  const canReply = data.viewer === 'member' && e.parentId === null && !e.deleted;
  return (
    <li id={`comment-${e.id}`} className="comment">
      {e.deleted ? (
        <p className="muted">This comment was deleted.</p>
      ) : (
        <>
          <p className="comment-meta">
            <strong>{e.name ?? 'A member'}</strong> ·{' '}
            <time dateTime={new Date(e.createdAt).toISOString()}>{relativeTime(e.createdAt, data.now)}</time>
          </p>
          {e.held && (
            <p className="comment-status">
              <strong>Waiting for review.</strong> Only you can see this until it is approved.
            </p>
          )}
          <p className="comment-body">{e.body}</p>
          {e.mine && <OwnActions e={e} data={data} />}
        </>
      )}
      {replies.length > 0 && (
        <ol className="comment-replies" aria-label="Replies">
          {replies.map((r) => (
            <Comment key={r.id} e={r} replies={[]} data={data} />
          ))}
        </ol>
      )}
      {canReply && (
        <details>
          <summary>Reply</summary>
          <CommentForm itemId={data.itemId} parentId={e.id} needsName={data.needsName} />
        </details>
      )}
    </li>
  );
}

export default function CommentList({ data }: { data: CommentSectionData }) {
  const all = entries(data);
  const tops = all.filter((e) => e.parentId === null);
  if (tops.length === 0) {
    return <p>No comments yet.</p>;
  }
  return (
    <ol className="comment-list">
      {tops.map((e) => (
        <Comment key={e.id} e={e} replies={all.filter((r) => r.parentId === e.id)} data={data} />
      ))}
    </ol>
  );
}
