import Link from 'next/link';
import { notFound } from 'next/navigation';
import Avatar from '@/components/Avatar';
import Breadcrumb from '@/components/Breadcrumb';
import { getDb } from '@/lib/db';
import { circlesEnabled, leaderboardEnabled } from '@/lib/config';
import { requireCirclesAdult } from '@/lib/circles/next';
import { listInvitableCircles } from '@/lib/circles/invites';
import { getLeaderByKey } from '@/lib/public/leaderboard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invite to a circle', robots: { index: false, follow: false } };

type Props = { params: Promise<{ key: string }>; searchParams: Promise<{ r?: string }> };

const RESULTS: Record<string, string> = {
  invalid: 'Please choose one of your circles, then send again.',
  'invite-duplicate': 'You already have an invite waiting for this member in that circle.',
  'invite-limit': 'You have sent as many invites as allowed for now. Please try again tomorrow.',
  'invite-member': 'That member is already in the circle you chose.',
  'invite-gone': 'That invite could not be sent. The member may have left the leaderboard.',
};

// Invite a leader into one of your circles (Project 4.11, ADR 0004). The leader is resolved from the public key
// in the address — never an account id — and must still be opted in and eligible. The send re-checks the inviter
// gate server-side; this page only shapes the choice. No email address is shown or sent anywhere.
export default async function LeaderInvitePage({ params, searchParams }: Props) {
  if (!leaderboardEnabled() || !circlesEnabled()) notFound();
  const { key } = await params;
  const { r } = await searchParams;
  const { account } = await requireCirclesAdult();
  const db = getDb();
  const leader = await getLeaderByKey(db, key, new Date());
  if (!leader) notFound();
  const mine = leader.accountId !== account.id ? await listInvitableCircles(db, account.id, new Date()) : [];
  return (
    <div className="container section">
      <Breadcrumb
        trail={[
          { name: 'Home', href: '/' },
          { name: 'Leaderboard', href: '/leaderboard/' },
          { name: 'Invite to a circle' },
        ]}
      />
      <h1>Invite to a circle</h1>
      {r && RESULTS[r] && (
        <div role="alert" id="result" tabIndex={-1} className="grown-ups">
          <p>{RESULTS[r]}</p>
        </div>
      )}
      <p className="board-row">
        <Avatar avatarKey={leader.avatarKey} size={44} />
        <span className="board-name">{leader.name}</span>
      </p>
      {leader.accountId === account.id ? (
        <p>This is your own leaderboard entry — you are already in your circles.</p>
      ) : mine.length === 0 ? (
        <p>
          You are not in a circle you can invite to yet. <Link href="/circles/">See your circles</Link> or start one,
          then come back.
        </p>
      ) : (
        <form method="post" action={`/leaderboard/invite/${key}/send/`} className="prose admin-form">
          <fieldset>
            <legend>Choose one of your circles</legend>
            {mine.map((c) => (
              <label className="admin-radio" key={c.slug}>
                <input type="radio" name="circle" value={c.slug} required /> {c.name}
              </label>
            ))}
          </fieldset>
          <p>
            {leader.name} will see the invite on their SparkKindly page and can accept or decline it. No email
            address is shown to either of you.
          </p>
          <button type="submit" className="button">
            Send invite
          </button>
        </form>
      )}
      <p>
        <Link href="/leaderboard/">Back to the leaderboard</Link>
      </p>
    </div>
  );
}
