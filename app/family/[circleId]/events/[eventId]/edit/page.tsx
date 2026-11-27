import Link from 'next/link';
import { getDb } from '@/lib/db';
import { circleOr404, requireHubAdult } from '@/lib/family-hub/next';
import { getCircle, getEvent, listKids, listMembers } from '@/lib/family-hub/repo';
import EventFields from '@/components/family-hub/EventFields';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ circleId: string; eventId: string }> };

export default async function EditEventPage({ params }: Props) {
  const ctx = await requireHubAdult();
  const { circleId, eventId } = await params;
  const db = getDb();
  const circle = circleOr404(await getCircle(db, circleId, ctx.account.id));
  const event = circleOr404(await getEvent(db, circleId, ctx.account.id, eventId));
  const members = (await listMembers(db, circleId, ctx.account.id)) ?? [];
  const kids = (await listKids(db, circleId, ctx.account.id)) ?? [];

  return (
    <>
      <h1>Edit event</h1>
      <p>
        <Link href={`/family/${circle.id}/calendar/`}>Back to the calendar</Link>
      </p>
      {event.recurrence && <p>This is a weekly series; saving changes the whole series.</p>}
      <form method="post" action={`/family/${circle.id}/events/update/`}>
        <input type="hidden" name="event_id" value={event.id} />
        <EventFields members={members} kids={kids} event={event} tz={circle.timeZone} />
        <button type="submit">Save event</button>
      </form>
      <form method="post" action={`/family/${circle.id}/events/delete/`}>
        <input type="hidden" name="event_id" value={event.id} />
        <button type="submit">Delete event</button>
      </form>
    </>
  );
}
