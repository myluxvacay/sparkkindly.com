import Link from 'next/link';
import ItemCard from '@/components/item/ItemCard';
import { dashboardFor, type Dashboard } from '@/lib/accounts/dashboard';
import { PLAYING_PAGE, requireContext } from '@/lib/accounts/next';
import { can } from '@/lib/accounts/policy';
import { circlesEnabled, contributorsEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { listAccountInvites, type PendingAccountInvite } from '@/lib/circles/invites';
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

// Outcome codes from the account-invite answers (Project 4.11).
const RESULTS: Record<string, { text: string; ok: boolean }> = {
  'invite-declined': { text: 'Invite declined.', ok: true },
  'invite-gone': { text: 'That invite is no longer waiting — it may have expired or been withdrawn.', ok: false },
  'invite-name': { text: 'Please add the name you will use in the circle, then accept again.', ok: false },
  'invite-refused': { text: 'That invite could not be accepted. The circle may be full or closed.', ok: false },
};

// Circle invites addressed to this account (Project 4.11, ADR 0004): accept with the name to use in the circle,
// or decline. Shown to the account holder only, never to a child profile.
function PendingInvites({ invites }: { invites: PendingAccountInvite[] }) {
  if (!invites.length) return null;
  return (
    <>
      <h2>Circle invites for you</h2>
      <ul className="admin-list">
        {invites.map((i) => (
          <li key={i.id}>
            <form method="post" action={`/me/invites/${i.id}/`} className="admin-form">
              <p>
                {i.inviterName} invited you to the {i.circleName} circle
                {i.expiresAt ? ` — this invite is open until ${new Date(i.expiresAt).toISOString().slice(0, 10)}` : ''}.
              </p>
              <p>
                <label htmlFor={`your-name-${i.id}`}>Your name in this circle</label>
                <input id={`your-name-${i.id}`} name="your_name" type="text" maxLength={30} />
              </p>
              <p className="admin-actions">
                <button type="submit" name="intent" value="accept" className="button">
                  Accept and join
                </button>{' '}
                <button type="submit" name="intent" value="decline" className="button" formNoValidate>
                  Decline
                </button>
              </p>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}

type Props = { searchParams: Promise<{ r?: string }> };

// The signed-in profile's own page (adult or child context). A child context sees kids and all items only, and gets no
// link to the adult account pages.
export default async function MePage({ searchParams }: Props) {
  const ctx = await requireContext();
  const { r } = await searchParams;
  const db = getDb();
  const [d, worldList] = await Promise.all([dashboardFor(db, ctx, new Date()), listWorlds(db)]);
  const pendingInvites =
    !ctx.profile && circlesEnabled() ? await listAccountInvites(db, ctx.account.id, new Date()) : [];
  const result = r ? RESULTS[r] : undefined;
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
      {result && (
        <div role={result.ok ? 'status' : 'alert'} id="result" tabIndex={-1} className={result.ok ? 'takeaway' : 'grown-ups'}>
          <p>{result.text}</p>
        </div>
      )}
      <PendingInvites invites={pendingInvites} />
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
