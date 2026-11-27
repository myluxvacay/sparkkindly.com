// The event create/edit fields (server component). Times are wall-clock in the circle's time
// zone; the web layer converts them to UTC instants on save.
import type { HubEvent, Kid, Member } from '@/lib/family-hub/repo';

export function localInputValue(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const p: Record<string, string> = {};
  for (const part of parts) if (part.type !== 'literal') p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export default function EventFields({ members, kids, event, tz, defaultLocal }: { members: Member[]; kids: Kid[]; event?: HubEvent; tz: string; defaultLocal?: string }) {
  const nowLocal = defaultLocal ?? '';
  return (
    <>
      <p>
        <label>
          Title
          <br />
          <input name="title" required maxLength={120} defaultValue={event?.title ?? ''} placeholder="Soccer practice" />
        </label>
      </p>
      <p>
        <label>
          Starts
          <br />
          <input name="starts_at" type="datetime-local" required defaultValue={event ? localInputValue(event.startsAt, tz) : nowLocal} />
        </label>{' '}
        <label>
          Ends
          <br />
          <input name="ends_at" type="datetime-local" required defaultValue={event ? localInputValue(event.endsAt, tz) : nowLocal} />
        </label>
      </p>
      <p>
        <label>
          Repeats
          <br />
          <select name="recurrence" defaultValue={event?.recurrence ?? ''}>
            <option value="">Does not repeat</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>{' '}
        <label>
          Repeat until (optional)
          <br />
          <input name="recurrence_until" type="date" defaultValue={event?.recurrenceUntil ? event.recurrenceUntil.toISOString().slice(0, 10) : ''} />
        </label>
      </p>
      <p>
        <label>
          Location
          <br />
          <input name="location" maxLength={200} defaultValue={event?.location ?? ''} placeholder="Riverside Elementary" />
        </label>
      </p>
      <p>
        <label>
          Notes
          <br />
          <input name="notes" maxLength={500} defaultValue={event?.notes ?? ''} />
        </label>
      </p>
      <fieldset>
        <legend>Who is part of it</legend>
        {members.map((m) => (
          <label key={m.userId} style={{ display: 'block' }}>
            <input type="checkbox" name="member" value={m.userId} defaultChecked={event?.memberIds.includes(m.userId)} /> {m.email}
          </label>
        ))}
        {kids.map((k) => (
          <label key={k.id} style={{ display: 'block' }}>
            <input type="checkbox" name="kid" value={k.id} defaultChecked={event?.kidIds.includes(k.id)} /> {k.firstName}
          </label>
        ))}
      </fieldset>
      <p>
        <label>
          <input type="checkbox" name="is_run" defaultChecked={event?.isRun} /> This is a pickup / drop-off run
        </label>
      </p>
      <p>
        <label>
          Driver (for a run)
          <br />
          <select name="driver" defaultValue={event?.driverUserId ?? ''}>
            <option value="">Nobody yet — needs a driver</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.email}
              </option>
            ))}
          </select>
        </label>
      </p>
    </>
  );
}
