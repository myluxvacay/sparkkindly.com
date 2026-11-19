import Link from 'next/link';
import { notFound } from 'next/navigation';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { promosEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { entrantStandings, listDraws, monthEnded } from '@/lib/promos/draw';
import { listEntries, listPromosAdmin } from '@/lib/promos/repo';
import { streakConfig } from '@/lib/promos/types';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string; promo?: string; month?: string }> };
const BACK = '/admin/promos/';

// Entrants and the monthly draw for one streak_draw promotion. Standings are recomputed from saved answers on
// every view (the streak engine derives them; nothing here trusts a stored claim). The draw itself is the
// promo.draw admin action: it records the pool size, a fresh seed, the method and the winners, and a drawn
// month can never be drawn again. Entrant and winner emails appear only on this admin page — never publicly.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function AdminPromoDrawPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  if (!promosEnabled()) notFound();
  const { done, error, promo: slug, month: monthParam } = await searchParams;
  const db = getDb();
  const now = new Date();
  // Default to the last completed month: the current month cannot be drawn until it has ended.
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonth = prev.toISOString().slice(0, 7);
  const month = monthParam && MONTH.test(monthParam) ? monthParam : lastMonth;
  const monthOpen = !monthEnded(month, now);

  const streakPromos = (await listPromosAdmin(db)).filter((p) => p.type === 'streak_draw');
  const promo = streakPromos.find((p) => p.slug === slug) ?? streakPromos[0];
  if (!promo) {
    return (
      <>
        <h1>Entrants &amp; draw</h1>
        <StatusNote done={done} error={error} />
        <p className="muted">No streak draw promotion exists yet. Create one under <Link href={BACK}>Promotions</Link>.</p>
      </>
    );
  }

  const [standings, draws, entries] = await Promise.all([
    entrantStandings(db, promo, month, now),
    listDraws(db, promo.id),
    listEntries(db, promo.id),
  ]);
  const pool = standings.filter((s) => s.completedInMonth);
  const drawn = draws.find((d) => d.month === month);
  const emailOf = new Map(entries.map((e) => [e.accountId, e.email]));
  const cfg = streakConfig(promo.config);

  return (
    <>
      <h1>Entrants &amp; draw — {promo.title}</h1>
      <StatusNote done={done} error={error} />
      <p className="muted">
        <Link href={BACK}>← All promotions</Link>
        {streakPromos.length > 1 && (
          <>
            {' · '}
            {streakPromos.map((p) => (
              <span key={p.id}>
                <Link href={`/admin/promos/draw/?promo=${p.slug}`}>{p.title}</Link>{' '}
              </span>
            ))}
          </>
        )}
      </p>

      <section aria-labelledby="standings">
        <h2 id="standings">
          Entrants ({entries.length}) — who completed in {month}
        </h2>
        <form method="get" className="admin-inline">
          <input type="hidden" name="promo" value={promo.slug} />
          <label htmlFor="month">Month (YYYY-MM)</label>{' '}
          <input id="month" name="month" defaultValue={month} maxLength={7} pattern="\d{4}-\d{2}" />{' '}
          <button type="submit" className="text-button">
            Show
          </button>
        </form>
        {standings.length === 0 ? (
          <p className="muted">Nobody has entered this promotion yet.</p>
        ) : (
          <ul className="admin-list">
            {standings.map((s) => (
              <li key={s.accountId}>
                {s.email} — entered {s.enteredAt.toISOString().slice(0, 10)} —{' '}
                {s.completedInMonth ? <strong>completed in {month} (in the pool)</strong> : `not completed in ${month}`}
              </li>
            ))}
          </ul>
        )}
        <p>
          Pool for {month}: <strong>{pool.length}</strong> entrant{pool.length === 1 ? '' : 's'}; the draw picks{' '}
          {Math.min(cfg.winnersPerDraw, pool.length)} winner{cfg.winnersPerDraw === 1 ? '' : 's'}.
        </p>
      </section>

      <section aria-labelledby="draw">
        <h2 id="draw">Run the draw for {month}</h2>
        {drawn ? (
          <p>
            This month was drawn on {drawn.drawnAt.toISOString().slice(0, 10)} by {drawn.drawnBy} from a pool of{' '}
            {drawn.poolSize}. A drawn month is never redrawn.
          </p>
        ) : monthOpen ? (
          <p className="muted">
            {month} has not ended yet, so it cannot be drawn — drawing now would lock out everyone who completes
            later in the month. Come back once the month is over.
          </p>
        ) : pool.length === 0 ? (
          <p className="muted">The pool is empty for {month}, so there is nobody to draw from yet.</p>
        ) : (
          <form method="post" action="/admin/act/" className="admin-form">
            <input type="hidden" name="csrf" value={admin.csrf} />
            <input type="hidden" name="action" value="promo.draw" />
            <input type="hidden" name="return" value={`/admin/promos/draw/?promo=${promo.slug}&month=${month}`} />
            <input type="hidden" name="id" value={promo.id} />
            <input type="hidden" name="month" value={month} />
            <p>
              This records the draw permanently: pool size, a fresh random seed, the method and the winners.
              Winners are told at their account email by the owner (gift cards are sent by hand — see
              OPERATIONS).
            </p>
            <button type="submit" className="button">
              Draw {Math.min(cfg.winnersPerDraw, pool.length)} winners for {month}
            </button>
          </form>
        )}
      </section>

      <section aria-labelledby="past-draws">
        <h2 id="past-draws">Past draws ({draws.length})</h2>
        {draws.length === 0 ? (
          <p className="muted">No month has been drawn yet.</p>
        ) : (
          <ul className="admin-list">
            {draws.map((d) => (
              <li key={d.id}>
                <strong>{d.month}</strong> — pool of {d.poolSize}, drawn {d.drawnAt.toISOString().slice(0, 10)} by{' '}
                {d.drawnBy}. Seed <code>{d.seed}</code>. Method: {d.method}
                <ul>
                  {d.winners.map((w) => (
                    <li key={w}>Winner: {emailOf.get(w) ?? w}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="muted">Promotion status: {promo.status}. Entries stay recorded even after a promotion ends, so a completed month can still be drawn.</p>
    </>
  );
}
