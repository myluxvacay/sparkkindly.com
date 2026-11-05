import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Result, type Messages } from '@/components/circles/Result';
import { ACCOUNT_COOKIE } from '@/lib/accounts/web';
import { circlesEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { inviteMetadata, loadInvitePage } from '@/lib/circles/invite-web';
import { previewInvite } from '@/lib/circles/invites';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ r?: string }> };

export async function generateMetadata({ params }: Props) {
  const p = circlesEnabled() ? await previewInvite(getDb(), (await params).token, new Date()) : null;
  return inviteMetadata(p);
}

const MESSAGES: Messages = {
  name: { text: 'Please type the name the circle will know you by (1 to 30 characters, no email address).', ok: false },
  capability: { text: 'Your account cannot join circles yet. A parent or guardian needs to confirm it first.', ok: false },
  community_age: { text: 'Communities are open to members aged 16 and over.', ok: false },
  has_child_adults_only: { text: 'This circle includes a child profile, so only adults (18 and over) can join it.', ok: false },
  full: { text: 'This circle is full (30 members).', ok: false },
  account_limit: { text: 'You are already in 10 circles. Leave one before joining another.', ok: false },
  removed: { text: 'The owner removed you from this circle, so you cannot join it again.', ok: false },
  already_member: { text: 'You are already in this circle.', ok: true },
};
const KIND = { friends: 'friends circle', family: 'family circle', community: 'community' } as const;

// Opening this page changes nothing but the open count (chat apps and scanners fetch links); joining is the POST.
export default async function InvitePage({ params, searchParams }: Props) {
  const [{ token }, { r }] = await Promise.all([params, searchParams]);
  const session = (await cookies()).get(ACCOUNT_COOKIE)?.value ?? '';
  const page = await loadInvitePage(getDb(), session, token, new Date());
  if (page.status !== 'ok') return notFound();
  const { preview, viewer, next } = page;
  const back = encodeURIComponent(next);
  return (
    <>
      <h1>Join {preview.circleName}</h1>
      <Result code={r} messages={MESSAGES} />
      <p>
        You are invited to a SparkKindly {KIND[preview.kind]} with {preview.memberCount}{' '}
        {preview.memberCount === 1 ? 'member' : 'members'}. Members play a short daily set of quizzes and games together
        and see each other&apos;s scores inside the circle only.
      </p>
      {viewer === 'anonymous' && (
        <p>
          To join, <Link href={`/account/sign-up/?next=${back}`}>create an account</Link> or{' '}
          <Link href={`/account/sign-in/?next=${back}`}>sign in</Link>. You come back to this page afterwards.
        </p>
      )}
      {viewer === 'child' && <p>Child profiles cannot join circles. The adult who manages this profile can join instead.</p>}
      {viewer === 'adult' && (
        <form method="post" action={`${next}accept/`} className="prose admin-form">
          <p>
            <label htmlFor="your_name">Your name in this circle</label>
            <input id="your_name" name="your_name" required maxLength={30} aria-describedby="your-name-hint" />
          </p>
          <p id="your-name-hint" className="muted">
            Other members see this name. They never see your email address.
          </p>
          <button type="submit" className="button">
            Join the circle
          </button>
        </form>
      )}
    </>
  );
}
