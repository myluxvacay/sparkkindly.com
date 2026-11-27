import Link from 'next/link';
import { getDb } from '@/lib/db';
import { circleOr404, requireHubAdult } from '@/lib/family-hub/next';
import { getCircle, listKids, listMembers, listOccurrences, type Occurrence } from '@/lib/family-hub/repo';
import { zonedDayRange } from '@/lib/family-hub/rules';
import EventFields, { localInputValue } from '@/components/family-hub/EventFields';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ circleId: string }>; searchParams: Promise<{ r?: string; d?: string }> };

const RESULTS: Record<string, { text: string; ok: boolean }> = {
  added: { text: 'Event added.', ok: true },
  saved: { text: 'Event saved.', ok: true },
  deleted: { text: 'Event deleted.', ok: true },
  invalid: { text: 'Please check the event: it needs a title, an end after its start, and people from this circle.', ok: false },
  limit: { text: 'This circle has reached its event limit.', ok: false },
  no: { text: 'That could not be done.', ok: false },
};

const dayKey = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const dayLabel = (d: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(d);
const timeLabel = (d: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);

export default async function CalendarPage({ params, searchParams }: Props) {
  const ctx = await requireHubAdult();
  const [{ circleId }, { r, d }] = await Promise.all([params, searchParams]);
  const db = getDb();
  const circle = circleOr404(await getCircle(db, circleId, ctx.account.id));
  const members = (await listMembers(db, circleId, ctx.account.id)) ?? [];
  const kids = (await listKids(db, circleId, ctx.account.id)) ?? [];
  const kidNames = new Map(kids.map((k) => [k.id, k.firstName]));
  const memberNames = new Map(members.map((m) => [m.userId, m.email]));

  const anchor = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00Z`) : new Date();
  const { from } = zonedDayRange(anchor, circle.timeZone);
  const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  const occ = (await listOccurrences(db, circleId, ctx.account.id, from, to)) ?? [];

  const days: { key: string; label: string; items: Occurrence[] }[] = [];
  for (let i = 0; i < 7; i++) {
    const dayStart = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
    days.push({ key: dayKey(dayStart, circle.timeZone), label: dayLabel(dayStart, circle.timeZone), items: [] });
  }
  for (const o of occ) {
    const day = days.find((x) => x.key === dayKey(o.startsAt, circle.timeZone));
    if (day) day.items.push(o);
  }
  const prev = new Date(from.getTime() - 7 * 24 * 60 * 60 * 1000);
  const next = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  const anchorOf = (x: Date) => dayKey(x, circle.timeZone);

  return (
    <>
      <h1>{circle.name} — calendar</h1>
      <p>
        <Link href={`/family/${circle.id}/`}>Circle</Link> · <Link href={`/family/${circle.id}/runs/`}>Runs board</Link> ·{' '}
        <Link href={`/family/${circle.id}/kids/`}>Kids</Link>
      </p>
      {r && RESULTS[r] && (
        <p id="result" role={RESULTS[r].ok ? undefined : 'alert'}>
          {RESULTS[r].text}
        </p>
      )}
      <p>
        <Link href={`/family/${circle.id}/calendar/?d=${anchorOf(prev)}`}>← Previous week</Link> ·{' '}
        <Link href={`/family/${circle.id}/calendar/`}>This week</Link> ·{' '}
        <Link href={`/family/${circle.id}/calendar/?d=${anchorOf(next)}`}>Next week →</Link>
      </p>
      {days.map((day) => (
        <section key={day.key}>
          <h2>{day.label}</h2>
          {day.items.length === 0 ? (
            <p>Nothing scheduled.</p>
          ) : (
            <ul className="admin-list">
              {day.items.map((o) => (
                <li key={`${o.event.id}-${o.startsAt.toISOString()}`}>
                  <strong>
                    {timeLabel(o.startsAt, circle.timeZone)}–{timeLabel(o.endsAt, circle.timeZone)}
                  </strong>{' '}
                  {o.event.title}
                  {o.event.location ? ` · ${o.event.location}` : ''}
                  {o.event.kidIds.length > 0 ? ` · ${o.event.kidIds.map((id) => kidNames.get(id)).filter(Boolean).join(', ')}` : ''}
                  {o.event.isRun
                    ? ` · run: ${o.event.runStatus === 'done' ? 'done' : o.event.runStatus === 'covered' ? `driver ${memberNames.get(o.event.driverUserId ?? '') ?? ''}` : 'needs a driver'}`
                    : ''}{' '}
                  <Link href={`/family/${circle.id}/events/${o.event.id}/edit/`}>Edit</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <h2>Add an event</h2>
      <form method="post" action={`/family/${circle.id}/events/create/`}>
        <EventFields members={members} kids={kids} tz={circle.timeZone} defaultLocal={localInputValue(new Date(new Date().getTime() + 60 * 60 * 1000), circle.timeZone)} />
        <button type="submit">Add event</button>
      </form>
    </>
  );
}
