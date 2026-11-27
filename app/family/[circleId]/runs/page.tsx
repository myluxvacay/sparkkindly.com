import Link from 'next/link';
import { getDb } from '@/lib/db';
import { circleOr404, requireHubAdult } from '@/lib/family-hub/next';
import { getCircle, listKids, listMembers, listRuns, type Kid, type Occurrence } from '@/lib/family-hub/repo';
import { AFFILIATE_DISCLOSURE, rideEligible, rideLinks, zonedDayRange } from '@/lib/family-hub/rules';
import Avatar from '@/components/family-hub/Avatar';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ circleId: string }>; searchParams: Promise<{ r?: string }> };

const RESULTS: Record<string, { text: string; ok: boolean }> = {
  'run-ok': { text: 'Run updated.', ok: true },
  'run-no': { text: 'That could not be done — only the driver or an organizer can release or finish a covered run.', ok: false },
};

const timeLabel = (d: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);
const dayLabel = (d: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(d);

function RideButtons({ occ, kids }: { occ: Occurrence; kids: Kid[] }) {
  // The 13-17-only rule: ride handoffs appear solely on an uncovered run carrying a teen.
  if (occ.event.runStatus !== 'uncovered') return null;
  const teens = kids.filter((k) => occ.event.kidIds.includes(k.id) && rideEligible(k.ageGroup));
  if (teens.length === 0) return null;
  const links = rideLinks(occ.event.location);
  return (
    <div style={{ marginTop: 8 }}>
      <p>
        Nobody in the circle can make this run? For {teens.map((t) => t.firstName).join(' and ')} (13–17), a parent can book a teen
        ride in their own rideshare app — PIN-checked and tracked by the parent:
      </p>
      <p>
        <a href={links.uber} target="_blank" rel="noreferrer">
          Book with Uber for Teens
        </a>{' '}
        ·{' '}
        <a href={links.lyft} target="_blank" rel="noreferrer">
          Book with Lyft Teen
        </a>
      </p>
      <p>
        <small>{AFFILIATE_DISCLOSURE} Under-13s cannot ride unaccompanied — for them this run needs a person from the circle.</small>
      </p>
    </div>
  );
}

export default async function RunsPage({ params, searchParams }: Props) {
  const ctx = await requireHubAdult();
  const [{ circleId }, { r }] = await Promise.all([params, searchParams]);
  const db = getDb();
  const circle = circleOr404(await getCircle(db, circleId, ctx.account.id));
  const members = (await listMembers(db, circleId, ctx.account.id)) ?? [];
  const kids = (await listKids(db, circleId, ctx.account.id)) ?? [];
  const memberNames = new Map(members.map((m) => [m.userId, m.email]));
  const kidById = new Map(kids.map((k) => [k.id, k]));

  const { from } = zonedDayRange(new Date(), circle.timeZone);
  const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  const runs = (await listRuns(db, circleId, ctx.account.id, from, to)) ?? [];

  return (
    <>
      <h1>{circle.name} — runs board</h1>
      <p>
        <Link href={`/family/${circle.id}/`}>Circle</Link> · <Link href={`/family/${circle.id}/calendar/`}>Calendar</Link> ·{' '}
        <Link href={`/family/${circle.id}/kids/`}>Kids</Link>
      </p>
      <p>Pickups and drop-offs for the next 7 days. Claim a run to take it, release it if plans change, mark it done when it is.</p>
      {r && RESULTS[r] && (
        <p id="result" role={RESULTS[r].ok ? undefined : 'alert'}>
          {RESULTS[r].text}
        </p>
      )}
      {runs.length === 0 ? (
        <p>No runs this week. Mark an event as a pickup / drop-off run on the calendar and it will appear here.</p>
      ) : (
        <ul className="admin-list">
          {runs.map((o) => {
            const runKids = o.event.kidIds.map((id) => kidById.get(id)).filter((k): k is Kid => Boolean(k));
            const canDrive = o.event.runStatus === 'covered' && (o.event.driverUserId === ctx.account.id || circle.role === 'organizer');
            return (
              <li key={`${o.event.id}-${o.startsAt.toISOString()}`} style={{ marginBottom: 16 }}>
                <strong>
                  {dayLabel(o.startsAt, circle.timeZone)}, {timeLabel(o.startsAt, circle.timeZone)}
                </strong>{' '}
                — {o.event.title}
                {o.event.location ? ` · ${o.event.location}` : ''}
                <br />
                {runKids.map((k) => (
                  <span key={k.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 10 }}>
                    <Avatar avatarId={k.avatarId} colour={k.colour} name={k.firstName} size={28} /> {k.firstName}
                    {k.phone ? (
                      <>
                        {' '}
                        <a href={`tel:${k.phone.replace(/[^+0-9]/g, '')}`}>Call</a> ·{' '}
                        <a href={`sms:${k.phone.replace(/[^+0-9]/g, '')}`}>Text</a>
                      </>
                    ) : null}
                  </span>
                ))}
                <br />
                Status:{' '}
                {o.event.runStatus === 'done'
                  ? 'done'
                  : o.event.runStatus === 'covered'
                    ? `covered by ${memberNames.get(o.event.driverUserId ?? '') ?? 'a member'}`
                    : 'needs a driver'}
                <div style={{ marginTop: 6 }}>
                  {o.event.runStatus !== 'done' && (
                    <form method="post" action={`/family/${circle.id}/runs/act/`} style={{ display: 'inline' }}>
                      <input type="hidden" name="event_id" value={o.event.id} />
                      <input type="hidden" name="action" value="claim" />
                      <button type="submit">{o.event.driverUserId === ctx.account.id ? 'I am driving' : 'I can drive'}</button>
                    </form>
                  )}{' '}
                  {canDrive && (
                    <>
                      <form method="post" action={`/family/${circle.id}/runs/act/`} style={{ display: 'inline' }}>
                        <input type="hidden" name="event_id" value={o.event.id} />
                        <input type="hidden" name="action" value="release" />
                        <button type="submit">Release</button>
                      </form>{' '}
                      <form method="post" action={`/family/${circle.id}/runs/act/`} style={{ display: 'inline' }}>
                        <input type="hidden" name="event_id" value={o.event.id} />
                        <input type="hidden" name="action" value="done" />
                        <button type="submit">Mark done</button>
                      </form>
                    </>
                  )}
                </div>
                <RideButtons occ={o} kids={kids} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
