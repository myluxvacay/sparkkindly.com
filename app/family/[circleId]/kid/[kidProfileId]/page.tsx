import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { requireHub } from '@/lib/family-hub/next';
import { kidPageState } from '@/lib/family-hub/web-kid';
import {
  kidChores, kidDay, kidFavourites, kidMealRequests, kidRewards, kidSelf,
} from '@/lib/family-hub/loops';
import { localDateString, scheduleLabel } from '@/lib/family-hub/rules';
import Avatar from '@/components/family-hub/Avatar';

export const dynamic = 'force-dynamic';

// The kid view: a PIN-return surface on a family device. It is gated by the kid-view
// session (the profile's own PIN), never by an account — see lib/family-hub/kid-session.ts.
// It shows only this kid's day, chores, points and meal requests: no settings, no members,
// no phone numbers, no other circle, nothing to administer.
type Props = { params: Promise<{ circleId: string; kidProfileId: string }>; searchParams: Promise<{ r?: string }> };

const RESULTS: Record<string, { text: string; ok: boolean }> = {
  marked: { text: 'Marked! A grown-up will check it, and then your points land.', ok: true },
  already: { text: 'That one is already marked for now.', ok: true },
  notdue: { text: 'That chore is not for today — check its next day below.', ok: false },
  'reward-asked': { text: 'Asked! A grown-up will say yes if the points are there.', ok: true },
  saving: { text: 'Not quite enough points yet — keep going!', ok: false },
  'meal-asked': { text: 'Request sent! Fingers crossed for dinner.', ok: true },
  limit: { text: 'Too many requests waiting — let a grown-up answer some first.', ok: false },
  invalid: { text: 'Hmm, that did not work. Try again?', ok: false },
  wrong: { text: 'That PIN was not right — try again.', ok: false },
  locked: { text: 'Too many tries. Ask a grown-up — it will work again in a little while.', ok: false },
  off: { text: 'The kid view is off right now.', ok: false },
};

const timeLabel = (d: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);

export default async function KidViewPage({ params, searchParams }: Props) {
  requireHub();
  const [{ circleId, kidProfileId }, { r }] = await Promise.all([params, searchParams]);
  const db = getDb();
  const h = await headers();
  const req = new Request('http://localhost', { headers: { cookie: h.get('cookie') ?? '' } });
  const now = new Date();
  const state = await kidPageState(db, req, circleId, kidProfileId, now);
  if (state.kind === 'missing') notFound();
  const base = `/family/${circleId}/kid/${kidProfileId}/`;
  const result = r && RESULTS[r] ? (
    <p id="result" role={RESULTS[r].ok ? undefined : 'alert'}>
      {RESULTS[r].text}
    </p>
  ) : null;

  if (state.kind === 'off') {
    return (
      <>
        <h1>Kid view</h1>
        {result}
        <p>The kid view is off for this profile. A grown-up can turn it on by setting a kid-view PIN on the Kids page.</p>
        <p>
          <Link href="/family/">Family Hub</Link>
        </p>
      </>
    );
  }

  if (state.kind === 'pin') {
    return (
      <>
        <h1>Who&rsquo;s looking?</h1>
        {result}
        <p>Type your kid-view PIN to open your page.</p>
        <form method="post" action={`${base}enter/`}>
          <p>
            <label>
              PIN
              <br />
              <input name="pin" type="password" inputMode="numeric" autoComplete="off" required maxLength={6} size={8} />
            </label>
          </p>
          <button type="submit">Open my page</button>
        </form>
      </>
    );
  }

  const ctx = state.ctx;
  const self = await kidSelf(db, ctx);
  if (!self) notFound();
  const { events, timeZone } = await kidDay(db, ctx, now);
  const chores = await kidChores(db, ctx, now);
  const { balance, rewards, mine } = await kidRewards(db, ctx);
  const favourites = await kidFavourites(db, ctx);
  const myMeals = await kidMealRequests(db, ctx);
  const today = localDateString(now, timeZone);
  const pendingRewardIds = new Set(mine.filter((m) => m.state === 'pending').map((m) => m.rewardId));

  return (
    <>
      <p style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar avatarId={self.avatarId} colour={self.colour} name={self.firstName} size={56} />
        <span style={{ fontSize: 28 }}>
          <strong>Hi, {self.firstName}!</strong>
        </span>
      </p>
      {result}

      <h2>Your day today</h2>
      {events.length === 0 ? (
        <p>Nothing on your schedule today. A free day!</p>
      ) : (
        <ul className="admin-list">
          {events.map((o) => (
            <li key={`${o.event.id}-${o.startsAt.toISOString()}`}>
              <strong>{o.event.title}</strong> — {timeLabel(o.startsAt, timeZone)} to {timeLabel(o.endsAt, timeZone)}
              {o.event.location ? ` at ${o.event.location}` : ''}
              {o.event.isRun ? ' (a pickup or drop-off)' : ''}
            </li>
          ))}
        </ul>
      )}

      <h2>Your chores</h2>
      {chores.length === 0 ? (
        <p>No chores right now.</p>
      ) : (
        <ul className="admin-list">
          {chores.map(({ chore, state: cs, dueToday, nextDueWeekday }) => (
            <li key={chore.id} style={{ marginBottom: 8, ...(dueToday ? {} : { opacity: 0.55 }) }}>
              <strong>{chore.title}</strong> — {chore.points} points ({scheduleLabel(chore.cadence, chore.scheduleDays).toLowerCase()}){' '}
              {!dueToday ? (
                <span>Next: {nextDueWeekday}</span>
              ) : cs === 'approved' ? (
                <span>Done — points added!</span>
              ) : cs === 'pending' ? (
                <span>Marked — waiting for a grown-up.</span>
              ) : (
                <form method="post" action={`${base}act/`} style={{ display: 'inline' }}>
                  <input type="hidden" name="action" value="mark" />
                  <input type="hidden" name="chore_id" value={chore.id} />
                  <button type="submit">{cs === 'declined' ? 'I did it this time' : 'I did it'}</button>
                </form>
              )}
              {dueToday && cs === 'declined' ? <span> (a grown-up sent this one back — have another go)</span> : null}
            </li>
          ))}
        </ul>
      )}

      <h2>Your points: {balance}</h2>
      {rewards.length === 0 ? (
        <p>No rewards yet — a grown-up can add some.</p>
      ) : (
        <ul className="admin-list">
          {rewards.map((w) => (
            <li key={w.id}>
              <strong>{w.title}</strong> — {w.costPoints} points{' '}
              {pendingRewardIds.has(w.id) ? (
                <span>Asked — waiting for a grown-up.</span>
              ) : balance >= w.costPoints ? (
                <form method="post" action={`${base}act/`} style={{ display: 'inline' }}>
                  <input type="hidden" name="action" value="reward" />
                  <input type="hidden" name="reward_id" value={w.id} />
                  <button type="submit">Ask for this</button>
                </form>
              ) : (
                <span>Keep saving — {w.costPoints - balance} to go.</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {mine.length > 0 && (
        <p>
          <small>
            Your recent asks:{' '}
            {mine
              .map((m) => `${m.rewardTitle} (${m.state === 'pending' ? 'waiting' : m.state === 'approved' ? 'yes — enjoy!' : 'not this time'})`)
              .join(' · ')}
          </small>
        </p>
      )}

      <h2>Ask for a dinner</h2>
      {favourites.length > 0 && (
        <form method="post" action={`${base}act/`}>
          <input type="hidden" name="action" value="meal" />
          <p>
            <label>
              Pick a favourite{' '}
              <select name="favourite_id" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {favourites.map((fv) => (
                  <option key={fv.id} value={fv.id}>
                    {fv.title}
                  </option>
                ))}
              </select>
            </label>{' '}
            <label>
              Day <input name="desired_day" type="date" min={today} />
            </label>{' '}
            <button type="submit">Ask</button>
          </p>
        </form>
      )}
      <form method="post" action={`${base}act/`}>
        <input type="hidden" name="action" value="meal" />
        <p>
          <label>
            Or your own idea <input name="meal_text" required maxLength={80} />
          </label>{' '}
          <label>
            Day <input name="desired_day" type="date" min={today} />
          </label>{' '}
          <button type="submit">Ask</button>
        </p>
      </form>
      {myMeals.length > 0 && (
        <>
          <h3>Your dinner asks</h3>
          <ul className="admin-list">
            {myMeals.map((m) => (
              <li key={m.id}>
                “{m.requestedText}” —{' '}
                {m.state === 'pending'
                  ? 'waiting for a grown-up'
                  : m.state === 'accepted'
                    ? 'yes! It is on the plan.'
                    : `not this time${m.declineMessage ? ` — “${m.declineMessage}”` : ''}`}
              </li>
            ))}
          </ul>
        </>
      )}

      <form method="post" action={`${base}exit/`}>
        <p>
          <button type="submit">Lock my page</button>
        </p>
      </form>
    </>
  );
}
