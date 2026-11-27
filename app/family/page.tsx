import Link from 'next/link';
import { getDb } from '@/lib/db';
import { requireHubAdult } from '@/lib/family-hub/next';
import { listActivity, listOccurrences, myCircles, type Occurrence } from '@/lib/family-hub/repo';
import { zonedDayRange } from '@/lib/family-hub/rules';
import Avatar from '@/components/family-hub/Avatar';
import { listKids } from '@/lib/family-hub/repo';
import HubInstallCard from '@/components/pwa/HubInstallCard';
import HubPushCard from '@/components/pwa/HubPushCard';
import { pushEnabled, vapidPublicKey } from '@/lib/family-hub/push-config';

export const dynamic = 'force-dynamic';

const timeFmt = (tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });

function RunLine({ o, tz, kidNames }: { o: Occurrence; tz: string; kidNames: Map<string, string> }) {
  const kids = o.event.kidIds.map((id) => kidNames.get(id)).filter(Boolean).join(', ');
  return (
    <li>
      <strong>{timeFmt(tz).format(o.startsAt)}</strong> — {o.event.title}
      {kids ? ` (${kids})` : ''}
      {o.event.location ? ` · ${o.event.location}` : ''} —{' '}
      {o.event.runStatus === 'done' ? 'done' : o.event.runStatus === 'covered' ? 'driver sorted' : <strong>needs a driver</strong>}
    </li>
  );
}

// Hub home: "today in your circle" for the first circle, plus the circle list.
export default async function FamilyHome() {
  const ctx = await requireHubAdult();
  const db = getDb();
  const circles = await myCircles(db, ctx.account.id);
  const primary = circles[0];

  let today: Occurrence[] = [];
  let runs: Occurrence[] = [];
  let activity: Awaited<ReturnType<typeof listActivity>> = [];
  let kidNames = new Map<string, string>();
  if (primary) {
    const { from, to } = zonedDayRange(new Date(), primary.timeZone);
    today = (await listOccurrences(db, primary.id, ctx.account.id, from, to)) ?? [];
    runs = today.filter((o) => o.event.isRun);
    activity = await listActivity(db, primary.id, ctx.account.id, 8);
    const kids = (await listKids(db, primary.id, ctx.account.id)) ?? [];
    kidNames = new Map(kids.map((k) => [k.id, k.firstName]));
  }
  const uncovered = runs.filter((o) => o.event.runStatus === 'uncovered');

  return (
    <>
      <h1>Family Hub</h1>
      <p>Your family&rsquo;s shared schedule, pickup &amp; drop-off runs and plans — private to your circle.</p>
      <HubInstallCard />
      <HubPushCard enabled={pushEnabled()} publicKey={vapidPublicKey()} />
      {circles.length === 0 ? (
        <p>
          You are not in a family circle yet. <Link href="/family/new/">Create your family circle</Link> to get started.
        </p>
      ) : (
        <>
          <h2>Your circles</h2>
          <ul className="admin-list">
            {circles.map((c) => (
              <li key={c.id}>
                <Link href={`/family/${c.id}/`}>{c.name}</Link> — {c.role === 'organizer' ? 'organizer' : 'member'} ·{' '}
                <Link href={`/family/${c.id}/calendar/`}>Calendar</Link> · <Link href={`/family/${c.id}/runs/`}>Runs</Link> ·{' '}
                <Link href={`/family/${c.id}/kids/`}>Kids</Link>
              </li>
            ))}
          </ul>
          <p>
            <Link href="/family/new/">Create another circle</Link>
          </p>
          {primary && (
            <>
              <h2>Today in {primary.name}</h2>
              {uncovered.length > 0 && (
                <p role="alert">
                  <strong>
                    {uncovered.length} run{uncovered.length === 1 ? '' : 's'} still need{uncovered.length === 1 ? 's' : ''} a driver today.
                  </strong>{' '}
                  <Link href={`/family/${primary.id}/runs/`}>Open the runs board</Link>
                </p>
              )}
              {today.length === 0 ? (
                <p>Nothing on the schedule today.</p>
              ) : (
                <ul className="admin-list">
                  {today.map((o) => (
                    <li key={`${o.event.id}-${o.startsAt.toISOString()}`}>
                      <strong>{timeFmt(primary.timeZone).format(o.startsAt)}</strong> — {o.event.title}
                      {o.event.location ? ` · ${o.event.location}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              {runs.length > 0 && (
                <>
                  <h3>Today&rsquo;s runs</h3>
                  <ul className="admin-list">
                    {runs.map((o) => (
                      <RunLine key={o.event.id} o={o} tz={primary.timeZone} kidNames={kidNames} />
                    ))}
                  </ul>
                </>
              )}
              {activity && activity.length > 0 && (
                <>
                  <h3>Recent activity</h3>
                  <ul className="admin-list">
                    {activity.map((a, i) => (
                      <li key={i}>
                        {a.message} <small>({a.createdAt.toLocaleString('en-US', { timeZone: primary.timeZone })})</small>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p aria-hidden>
                <Avatar avatarId="spark" colour="purple" name="Spark" size={32} />
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}
