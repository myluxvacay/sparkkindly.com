import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ChildControls } from '@/components/circles/ChildControls';
import { MemberList } from '@/components/circles/MemberList';
import { OwnerControls } from '@/components/circles/OwnerControls';
import { Result, type Messages } from '@/components/circles/Result';
import { PLAYING_PAGE } from '@/lib/accounts/next';
import { ACCOUNT_COOKIE } from '@/lib/accounts/web';
import { loadCirclePage } from '@/lib/circles/web';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Circle' };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ r?: string }> };

const MESSAGES: Messages = {
  created: { text: 'Your circle is ready.', ok: true },
  transferred: { text: 'Ownership is handed over.', ok: true },
  removed: { text: 'The member is removed.', ok: true },
  closed: { text: 'The circle is closed.', ok: true },
  'child-added': { text: 'The child profile is in the circle.', ok: true },
  'child-removed': { text: 'The child profile is out of the circle.', ok: true },
  confirm: { text: 'Please tick the box to confirm, then try again.', ok: false },
  'not-owner': { text: 'Only the circle owner can do that.', ok: false },
  'read-only': { text: 'This circle is closed and cannot change.', ok: false },
  'member-gone': { text: 'That person is no longer in the circle.', ok: false },
  'is-owner': { text: 'You are the owner. Hand over ownership or close the circle instead.', ok: false },
  'not-eligible': { text: 'Only another adult member of the circle can become its owner.', ok: false },
  'owner-leave': { text: 'As the owner, hand over ownership or close the circle before leaving.', ok: false },
  'child-invalid': { text: 'Please choose a child profile and tick the box to confirm.', ok: false },
  'child-no': { text: 'You can add only your own child profiles, to an open circle you are in.', ok: false },
  'child-family': { text: 'Child profiles can join family circles only.', ok: false },
  'child-teen': { text: 'This circle has a member aged 13 to 17, so child profiles cannot join it.', ok: false },
  'child-limit': { text: 'This circle is full (30 members).', ok: false },
  'child-already': { text: 'That child profile is already in the circle.', ok: false },
  'child-gone': { text: 'That child profile is not in the circle.', ok: false },
};
const KIND = { friends: 'Friends circle', family: 'Family circle', community: 'Community circle' } as const;

export default async function CirclePage({ params, searchParams }: Props) {
  const [{ slug }, { r }] = await Promise.all([params, searchParams]);
  const token = (await cookies()).get(ACCOUNT_COOKIE)?.value ?? '';
  const page = await loadCirclePage(getDb(), token, slug, new Date());
  if (page.status === 'sign_in') return redirect('/account/sign-in/');
  if (page.status === 'child') return redirect(PLAYING_PAGE);
  if (page.status !== 'ok') return notFound();
  const { view, children } = page;
  const myChildren = view.members.filter((m) => m.isChild && m.isMine);
  const open = view.status === 'open';
  return (
    <>
      <h1>{view.name}</h1>
      <Result code={r} messages={MESSAGES} />
      <p>
        {KIND[view.kind]}. Time zone {view.timeZone}.
      </p>
      {view.description && <p>{view.description}</p>}
      {!open && <p role="note">This circle is closed. It is deleted 30 days after closing.</p>}
      <h2>Members</h2>
      <MemberList members={view.members} />
      {open && view.myRole === 'owner' && <OwnerControls slug={view.slug} members={view.members} />}
      {open && <ChildControls slug={view.slug} addable={children} inCircle={myChildren} />}
      {view.myRole === 'member' && (
        <form method="post" action={`/circles/${view.slug}/leave/`}>
          <h2>Leave</h2>
          <p>Your past answers stay in the circle as &quot;former member&quot;.</p>
          <button type="submit" className="button">
            Leave this circle
          </button>
        </form>
      )}
      <p>
        <Link href="/circles/">Back to your circles</Link>
      </p>
    </>
  );
}
