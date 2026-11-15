import Link from 'next/link';
import { notFound } from 'next/navigation';
import Breadcrumb from '@/components/Breadcrumb';
import Avatar from '@/components/Avatar';
import { getDb } from '@/lib/db';
import { leaderboardEnabled } from '@/lib/config';
import { currentViewer } from '@/lib/accounts/scope-next';
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
function Board({ title, rows }: { title: string; rows: PublicBoardRow[] }) {
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
          </li>
        ))}
      </ol>
    </section>
  );
}

export default async function LeaderboardPage() {
  if (!leaderboardEnabled()) notFound();
  const viewer = await currentViewer();
  const youId = viewer.owner && !viewer.owner.profileId ? viewer.owner.accountId : null;
  const boards = await getPublicBoards(getDb(), new Date(), youId);
  const empty = !boards.month.length && !boards.allTime.length;
  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: 'Leaderboard' }]} />
      <p className="eyebrow">THE PUBLIC BOARD</p>
      <h1>Leaderboard</h1>
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
          <Board title="This month" rows={boards.month} />
          <Board title="All time" rows={boards.allTime} />
        </>
      )}
    </div>
  );
}
