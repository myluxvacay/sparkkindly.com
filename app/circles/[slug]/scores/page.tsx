import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ACCOUNT_COOKIE } from '@/lib/accounts/web';
import { loadScoresPage } from '@/lib/circles/play-web';
import type { Board } from '@/lib/circles/scores';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Circle scores' };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ p?: string }> };

const PERIODS = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'allTime', label: 'All time' },
] as const;
type Period = (typeof PERIODS)[number]['key'];

function ScoreTable({ board, caption }: { board: Board; caption: string }) {
  return (
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Member</th>
          <th scope="col">Points</th>
        </tr>
      </thead>
      <tbody>
        {board.map((r, i) => (
          <tr key={i}>
            <td>{r.rank}</td>
            <th scope="row">
              {r.name}
              {r.you && ' (you)'}
            </th>
            <td>{r.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Scores for current members only (a child profile included). Period tabs are plain links; no timers, no streaks.
export default async function CircleScoresPage({ params, searchParams }: Props) {
  const [{ slug }, { p }] = await Promise.all([params, searchParams]);
  const token = (await cookies()).get(ACCOUNT_COOKIE)?.value ?? '';
  const page = await loadScoresPage(getDb(), token, slug, new Date());
  if (page.status === 'sign_in') return redirect('/account/sign-in/');
  if (page.status !== 'ok') return notFound();
  const period: Period = PERIODS.find((x) => x.key === p)?.key ?? 'day';
  const label = PERIODS.find((x) => x.key === period)!.label;
  const base = `/circles/${page.circle.slug}/scores/`;
  return (
    <>
      <h1>Scores: {page.circle.name}</h1>
      <nav aria-label="Score period">
        <ul>
          {PERIODS.map((x) => (
            <li key={x.key}>
              <Link href={`${base}?p=${x.key}`} aria-current={x.key === period ? 'page' : undefined}>
                {x.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <ScoreTable board={page.tallies[period]} caption={`${label}: points per member`} />
      <p>
        Whole circle, {label.toLowerCase()}: {page.tallies.circleTotals[period]} points.
      </p>
      <p>
        Members with the same points share a rank, and the next rank skips (for example 1, 1, 3). Points come from correct answers to the
        circle&apos;s set on the day it was set; speed does not count. &quot;Former member&quot; is someone who has left the circle.
      </p>
      <p>
        <Link href={`/circles/${page.circle.slug}/set/`}>Today&apos;s set</Link>
      </p>
    </>
  );
}
