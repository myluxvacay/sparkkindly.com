// A new comment or a reply (plan 7A): a plain POST form to /comments/post/, no JavaScript needed. On the account's
// first comment it also asks for a display name and the community guidelines tick. The server re-checks everything.
import Link from 'next/link';

type Props = { itemId: string; parentId?: string; needsName: boolean };

export default function CommentForm({ itemId, parentId, needsName }: Props) {
  const key = parentId ?? 'new';
  return (
    <form method="post" action="/comments/post/" className="admin-form comment-form">
      <input type="hidden" name="item" value={itemId} />
      {parentId && <input type="hidden" name="parent" value={parentId} />}
      <label htmlFor={`comment-body-${key}`}>{parentId ? 'Your reply' : 'Your comment'}</label>
      <p id={`comment-help-${key}`} className="muted">
        Plain text, up to 1,000 characters. Links are not shown as links.
      </p>
      <textarea id={`comment-body-${key}`} name="body" rows={4} required aria-describedby={`comment-help-${key}`} />
      {needsName && (
        <>
          <label htmlFor={`comment-name-${key}`}>Display name</label>
          <p id={`comment-name-help-${key}`} className="muted">
            Shown beside your comments, 1 to 30 characters. Your email is never shown.
          </p>
          <input
            id={`comment-name-${key}`}
            name="display_name"
            type="text"
            required
            autoComplete="nickname"
            aria-describedby={`comment-name-help-${key}`}
          />
          <label className="admin-radio">
            <input type="checkbox" name="guidelines" required /> I have read the{' '}
            <Link href="/community/guidelines/">community guidelines</Link>
          </label>
        </>
      )}
      <button type="submit" className="button">
        {parentId ? 'Post reply' : 'Post comment'}
      </button>
    </form>
  );
}
