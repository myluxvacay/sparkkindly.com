import Link from 'next/link';
import ItemCard from '@/components/item/ItemCard';
import { dashboardFor, type Dashboard } from '@/lib/accounts/dashboard';
import { PLAYING_PAGE, requireContext } from '@/lib/accounts/next';
import { can } from '@/lib/accounts/policy';
import { contributorsEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import type { PublicItem } from '@/lib/items/repo';
import { listWorlds, type World } from '@/lib/public/worlds';

export const dynamic = 'force-dynamic';

// Plain counts only: no streaks, no targets, nothing about days without answers.
function progressText({ total, correct }: Dashboard['progress']): string {
  if (total === 0) return 'Answers you give to quizzes and games will show here.';
  return `You have answered ${total} ${total === 1 ? 'item' : 'items'}, ${correct} correct.`;
}

function Items({ items, worlds, empty }: { items: PublicItem[]; worlds: Map<string, World>; empty: string }) {
  if (items.length === 0) return <p>{empty}</p>;
  return (
    <div className="content-grid two-col">
      {items.map((i) => (
        <ItemCard item={i} world={worlds.get(i.world)} key={i.id} />
      ))}
    </div>
  );
}

function Answered({ answered }: { answered: Dashboard['answered'] }) {
  if (answered.length === 0) return null;
  return (
    <ul>
      {answered.map((a) => (
        <li key={a.item.id}>
          <Link href={`/${a.item.world}/${a.item.slug}/`}>{a.item.title}</Link>: {a.correct ? 'correct' : 'answered'}
        </li>
      ))}
    </ul>
  );
}

// The signed-in profile's own page (adult or child context). A child context sees kids and all items only, and gets no
// link to the adult account pages.
export default async function MePage() {
  const ctx = await requireContext();
  const db = getDb();
  const [d, worldList] = await Promise.all([dashboardFor(db, ctx, new Date()), listWorlds(db)]);
  const worlds = new Map(worldList.map((w) => [w.slug, w]));
  const savesAnswers = ctx.profile !== null || can(ctx.account.ageGroup, ctx.account.consent, 'save_answers');
  return (
    <>
      <h1>{ctx.profile ? `Hello, ${ctx.profile.displayName}` : 'Your SparkKindly'}</h1>
      <p>
        <Link href="/me/interests/">Choose your interests</Link>
        {ctx.profile ? (
          <>
            {' '}
            · <Link href={PLAYING_PAGE}>Playing as {ctx.profile.displayName}</Link>
          </>
        ) : (
          <>
            {' '}
            · <Link href="/account/">Your account</Link>
            {contributorsEnabled() && can(ctx.account.ageGroup, ctx.account.consent, 'contribute') && (
              <>
                {' '}
                · <Link href="/me/contribute/">Write for SparkKindly</Link>
              </>
            )}
          </>
        )}
      </p>
      {!d.hasInterests && (
        <p>Pick a few worlds or topics you like, and items that match them will show here.</p>
      )}
      {d.hasInterests && (
        <>
          <h2>Today</h2>
          <Items items={d.today} worlds={worlds} empty="Nothing new for your interests today. Recent items are below." />
          <h2>The last two weeks</h2>
          <Items items={d.recent} worlds={worlds} empty="Nothing from the last two weeks matches your interests yet." />
        </>
      )}
      <h2>Your answers</h2>
      <p>{savesAnswers ? progressText(d.progress) : 'Answers are saved once your parent or guardian confirms the account.'}</p>
      <Answered answered={d.answered} />
    </>
  );
}
