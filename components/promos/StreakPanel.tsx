import Link from 'next/link';
import { currentContext } from '@/lib/accounts/next';
import { currentViewer } from '@/lib/accounts/scope-next';
import { getDb } from '@/lib/db';
import { getEntry, type Promo } from '@/lib/promos/repo';
import { streakForOwner, type StreakState } from '@/lib/promos/streak';
import { streakConfig } from '@/lib/promos/types';

// The streak_draw mechanic panel on a promo page: the signed-in player's own streak (derived from their saved
// answers by the streak engine) and, for grown-up account holders, the draw entry. Which panel a promo gets is
// decided by its record's type in the promo page; a future type adds its own panel the same way. Entry results
// arrive as ?r= codes from the entry route (lib/promos/enter-web.ts) and are worded here, never by the route.

const RESULTS: Record<string, { text: string; ok: boolean }> = {
  entered: { text: 'You are in! Every month you complete the streak, you are in that month’s draw.', ok: true },
  already: { text: 'You are already entered — one entry is all it takes.', ok: true },
  attest: { text: 'Please tick the box confirming you are 18 or older, then enter again.', ok: false },
  grownups: { text: 'The prize draw is for grown-ups (18 or older). Your streak still counts — keep it growing!', ok: false },
  closed: { text: 'This promotion is not open for entries right now.', ok: false },
};

function Result({ code }: { code?: string }) {
  const r = code ? RESULTS[code] : undefined;
  if (!r) return null;
  return (
    <div role={r.ok ? 'status' : 'alert'} id="result" tabIndex={-1} className={r.ok ? 'takeaway' : 'grown-ups'}>
      <p>{r.text}</p>
    </div>
  );
}

function StreakFacts({ s, target }: { s: StreakState; target: number }) {
  const left = Math.max(0, target - s.current);
  return (
    <div>
      <p>
        <strong>
          Your streak: {s.current} of {target} days
        </strong>
        {s.best > s.current && <> (your best so far is {s.best})</>}
      </p>
      {s.completedOn.length > 0 && (
        <p>
          You have completed the streak {s.completedOn.length} {s.completedOn.length === 1 ? 'time' : 'times'}. Lovely work.
        </p>
      )}
      {s.current > 0 && left > 0 && (
        <p>
          {left} {left === 1 ? 'day' : 'days'} to go in this attempt.{' '}
          {s.freezeLeft > 0 ? 'Your streak-freeze is still in your pocket.' : 'Your streak-freeze has been used in this attempt — no pressure, just keep going.'}
        </p>
      )}
      {s.todayDone ? (
        <p>Today’s Question of the Day: answered. Come back tomorrow to grow the streak.</p>
      ) : (
        <p>
          Today’s Question of the Day is still waiting: <Link href="/quiz/">answer it now</Link> to grow your streak.
        </p>
      )}
    </div>
  );
}

export default async function StreakPanel({ promo, r }: { promo: Promo; r?: string }) {
  const cfg = streakConfig(promo.config);
  const ctx = await currentContext();
  const db = getDb();

  if (!ctx) {
    return (
      <section aria-labelledby="streak-heading">
        <h2 id="streak-heading">Play along with Spark</h2>
        <p>
          Your streak is counted from the answers saved to your account, so you need a free SparkKindly account to
          play. It takes a moment, and it is always free.
        </p>
        <p>
          <Link className="button gold-button" href="/account/sign-up/">
            Create your free account
          </Link>{' '}
          <Link className="underlined" href="/account/sign-in/">
            Sign in
          </Link>
        </p>
        <p>
          Just curious today? <Link href="/quiz/">Try today’s question</Link> — it just will not count toward a
          streak until you are signed in.
        </p>
      </section>
    );
  }

  // The streak belongs to whoever is playing: the account holder, or the active child profile. It is bounded
  // by the promotion's own start — days before this promotion existed never count toward it.
  const viewer = await currentViewer();
  const owner = viewer.owner;
  const streak = owner ? await streakForOwner(db, owner, new Date(), cfg, { sinceDay: promo.startsOn }) : null;
  const isHolder = ctx.profile === null;
  const entry = isHolder ? await getEntry(db, promo.id, ctx.account.id) : null;

  return (
    <section aria-labelledby="streak-heading">
      <h2 id="streak-heading">Your streak</h2>
      {streak ? (
        <StreakFacts s={streak} target={cfg.targetDays} />
      ) : (
        <p>Your answers are not being saved right now, so a streak cannot grow yet.</p>
      )}
      <div id="entry">
        <Result code={r} />
        {isHolder ? (
          ctx.account.ageGroup !== 'adult' ? (
            <p>
              The prize draw is for grown-ups (18 or older), so this account cannot enter it. You can still build
              and complete a streak — Spark is proud of you either way.
            </p>
          ) : entry ? (
            <p role="status">
              <strong>You are entered in the draw.</strong> Every month you complete the streak, you are in that
              month’s drawing — no need to enter again.
            </p>
          ) : (
            <form method="post" action={`/promos/${promo.slug}/enter/`}>
              <p>
                <label className="admin-radio" htmlFor="attest">
                  <input type="checkbox" id="attest" name="attest" value="yes" required /> I confirm I am 18 or
                  older and I would like to enter the monthly prize draw.
                </label>
              </p>
              <button type="submit" className="button gold-button">
                Enter the draw — it’s free
              </button>
            </form>
          )
        ) : (
          <p>
            This is a child profile: it can play, streak and complete the challenge, but the prize draw is for
            grown-ups (18 or older), so there is no entry here.
          </p>
        )}
      </div>
    </section>
  );
}
