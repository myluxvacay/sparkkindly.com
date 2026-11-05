import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Result, type Messages } from '@/components/circles/Result';
import { currentContext } from '@/lib/accounts/next';
import { COMMUNITY_PAGE, listCommunities } from '@/lib/circles/communities';
import { circlesEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { parsePage } from '@/lib/public/paging';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Communities' };

type Props = { searchParams: Promise<{ r?: string; page?: string }> };

const MESSAGES: Messages = {
  name: { text: 'Please type the name the community will know you by (1 to 30 characters, no email address).', ok: false },
  capability: { text: 'Your account cannot join circles yet. A parent or guardian needs to confirm it first.', ok: false },
  community_age: { text: 'Communities are open to members aged 16 and over.', ok: false },
  full: { text: 'That community is full (30 members).', ok: false },
  account_limit: { text: 'You are already in 10 circles. Leave one before joining another.', ok: false },
  removed: { text: 'The owner removed you from that community, so you cannot join it again.', ok: false },
  already_member: { text: 'You are already in that community.', ok: true },
  closed: { text: 'That community is not available any more.', ok: false },
  invite_only: { text: 'That circle can be joined only through an invite.', ok: false },
};

// Public: name, description and member count of open communities, newest first. Never who is in them.
export default async function CommunitiesPage({ searchParams }: Props) {
  if (!circlesEnabled()) return notFound();
  const { r, page: raw } = await searchParams;
  const page = parsePage(raw);
  const [list, ctx] = await Promise.all([listCommunities(getDb(), page), currentContext()]);
  const canJoin = ctx !== null && ctx.profile === null;
  return (
    <>
      <h1>Communities</h1>
      <Result code={r} messages={MESSAGES} />
      <p>Communities are open circles anyone aged 16 and over can join. Friends and family circles are invite-only.</p>
      {!canJoin && (
        <p>
          <Link href="/account/sign-in/">Sign in</Link> to join a community.
        </p>
      )}
      {list.length === 0 ? (
        <p>{page === 1 ? 'There are no communities yet.' : 'No more communities.'}</p>
      ) : (
        <ul className="admin-list">
          {list.map((c) => (
            <li key={c.slug}>
              <h2>{c.name}</h2>
              {c.description && <p>{c.description}</p>}
              <p className="muted">
                {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
              </p>
              {canJoin && (
                <form method="post" action="/circles/communities/join/" className="admin-form">
                  <input type="hidden" name="slug" value={c.slug} />
                  <p>
                    <label htmlFor={`name-${c.slug}`}>Your name in {c.name}</label>
                    <input id={`name-${c.slug}`} name="your_name" required maxLength={30} />
                  </p>
                  <button type="submit" className="button">
                    Join {c.name}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Pages">
        {page > 1 && <Link href={`/circles/communities/?page=${page - 1}`}>Newer communities</Link>}{' '}
        {list.length === COMMUNITY_PAGE && <Link href={`/circles/communities/?page=${page + 1}`}>Older communities</Link>}
      </nav>
    </>
  );
}
