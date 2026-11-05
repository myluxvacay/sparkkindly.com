import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ACCOUNT_COOKIE } from '@/lib/accounts/web';
import { loadSetPage, type AnswerState } from '@/lib/circles/play-web';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: "Today's circle set" };

type Props = { params: Promise<{ slug: string }> };

const STATE: Record<AnswerState, string> = {
  answered: 'Answered',
  earlier: 'Answered on another day (does not score today)',
  not_yet: 'Not yet',
};

// The circle's daily set for current members, a child profile included. Answers are made on the normal item pages.
export default async function CircleSetPage({ params }: Props) {
  const { slug } = await params;
  const token = (await cookies()).get(ACCOUNT_COOKIE)?.value ?? '';
  const page = await loadSetPage(getDb(), token, slug, new Date());
  if (page.status === 'sign_in') return redirect('/account/sign-in/');
  if (page.status !== 'ok') return notFound();
  return (
    <>
      <h1>Today&apos;s set: {page.circle.name}</h1>
      <p>
        The set for {page.day} (the circle&apos;s own day). Each correct answer given today scores points for you in this circle. No
        timer: take as long as you like.
      </p>
      {page.items.length === 0 ? (
        <p>There are no items for today yet. Please look again later.</p>
      ) : (
        <ol>
          {page.items.map((i) => (
            <li key={i.itemId}>
              <Link href={`/${i.worldSlug}/${i.slug}/`}>{i.title}</Link>
              {i.bonus && ' (bonus)'}. <span>{STATE[i.state]}.</span>
            </li>
          ))}
        </ol>
      )}
      <p>&quot;Bonus&quot; items come from outside the circle&apos;s chosen topics, when there were not enough matching items today.</p>
      <p>
        <Link href={`/circles/${page.circle.slug}/scores/`}>See the scores</Link>
      </p>
    </>
  );
}
