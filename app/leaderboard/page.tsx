import Link from 'next/link';
import { notFound } from 'next/navigation';
import Breadcrumb from '@/components/Breadcrumb';
import Avatar from '@/components/Avatar';
import { getDb } from '@/lib/db';
import { circlesEnabled, leaderboardEnabled } from '@/lib/config';
import { currentViewer } from '@/lib/accounts/scope-next';
import { listInvitableCircles } from '@/lib/circles/invites';
import { getPublicBoards, type PublicBoardRow } from '@/lib/public/leaderboard';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return leaderboardEnabled()
    ? seo(
        'Leaderboard',
        'The SparkKindly public leaderboard: members aged 16 and over who chose to appear, ranked by the points their own correct answers earned.',
        '/leaderboard/',
      )
    : {};
}

// The public leaderboard (Project 4.11, ADR 0004). Everyone listed opted in and is 16 or over; the board shows a
// chosen public name, a chosen avatar and points only — never an email, a real name or anything about a child.
// The reads behind it (lib/public/leaderboard.ts) re-derive eligibility on every load.
function Board({ title, rows, canInvite }: { title: string; rows: PublicBoardRow[]; canInvite: boolean }) {
  if (!rows.length) return null;
  return (
    <section>
      <h2>{title}</h2>
      <ol className="board">
        {rows.map((r) => (
          <li key={r.name} className={r.you ? 'board-row you' : 'board-row'}>
            <span className="board-rank" aria-label={`Rank ${r.rank}`}>
              {r.rank}
            </span>
            <Avatar avatarKey={r.avatarKey} size={44} />
            <span className="board-name">
              {r.name}
              {r.you ? ' (you)' : ''}
            </span>
            <span className="board-points">
              <strong>{r.points} points</strong>
              {r.correct} correct
            </span>
            {canInvite && !r.you && (
              <Link className="board-invite" href={`/leaderboard/invite/${r.inviteKey}/`}>
                Invite to a circle
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

type Props = { searchParams: Promise<{ r?: string }> };

export default async function LeaderboardPage({ searchParams }: Props) {
  if (!leaderboardEnabled()) notFound();
  const { r } = await searchParams;
  const viewer = await currentViewer();
  const youId = viewer.owner && !viewer.owner.profileId ? viewer.owner.accountId : null;
  const db = getDb();
  const boards = await getPublicBoards(db, new Date(), youId);
  const canInvite =
    youId !== null && circlesEnabled() ? (await listInvitableCircles(db, youId, new Date())).length > 0 : false;
  const empty = !boards.week.length && !boards.month.length && !boards.allTime.length;
  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: 'Leaderboard' }]} />
      <p className="eyebrow">THE PUBLIC BOARD</p>
      <h1>Leaderboard</h1>
      {r === 'invited' && (
        <div role="status" id="result" tabIndex={-1} className="takeaway">
          <p>Invite sent. It is waiting on their SparkKindly page.</p>
        </div>
      )}
      {r === 'invite-gone' && (
        <div role="alert" id="result" tabIndex={-1} className="grown-ups">
          <p>That invite could not be sent. The member may have left the leaderboard.</p>
        </div>
      )}
      <p className="intro-text">
        Members aged 16 and over who chose to appear, ranked by the points their own correct answers earned —
        points for every correct answer, nothing for speed. Joining is up to you: turn it on in your settings, pick
        a public name and an avatar, and you are on the board with your next correct answer.
      </p>
      {youId && (
        <p>
          <Link href="/account/settings/">Join or update your leaderboard entry</Link>
        </p>
      )}
      {empty ? (
        <p>
          Nobody is on the board yet. <Link href="/quiz/">Play today’s quiz</Link> and be the first name here.
        </p>
      ) : (
        <>
          <Board title="This week" rows={boards.week} canInvite={canInvite} />
          <Board title="This month" rows={boards.month} canInvite={canInvite} />
          <Board title="All time" rows={boards.allTime} canInvite={canInvite} />
        </>
      )}
    </div>
  );
}
