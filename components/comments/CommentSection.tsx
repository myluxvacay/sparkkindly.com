// The item page's comment section (plan 7A). The page renders it only when loadCommentSection returned data, so a
// child context, a Kids item, a switched-off item and the flags-off site get no section in the HTML at all.
import Link from 'next/link';
import { Result } from '@/components/circles/Result';
import { COMMENT_MESSAGES, type CommentSectionData } from '@/lib/comments/web';
import CommentForm from './CommentForm';
import CommentList from './CommentList';

function Join({ data }: { data: CommentSectionData }) {
  switch (data.viewer) {
    case 'member':
      return <CommentForm itemId={data.itemId} needsName={data.needsName} />;
    case 'banned':
      return <p>Your account can no longer post comments.</p>;
    case 'not_allowed':
      return <p>Comments are open to members aged 16 and over.</p>;
    default:
      return (
        <p>
          <Link href="/account/sign-in/">Sign in</Link> to join the conversation (members aged 16 and over).
        </p>
      );
  }
}

export default function CommentSection({ data, code }: { data: CommentSectionData; code?: string }) {
  return (
    <section id="comments" aria-labelledby="comments-heading" className="container section comments">
      <h2 id="comments-heading">Comments</h2>
      <Result code={code} messages={COMMENT_MESSAGES} />
      <CommentList data={data} />
      <Join data={data} />
      <p className="muted">
        Please read the <Link href="/community/guidelines/">community guidelines</Link>. Comments are checked before or after
        they appear.
      </p>
    </section>
  );
}
