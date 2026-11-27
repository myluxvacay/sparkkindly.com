import Link from 'next/link';
import { getDb } from '@/lib/db';
import { circleOr404, requireHubAdult } from '@/lib/family-hub/next';
import { getCircle, listActivity, listMembers } from '@/lib/family-hub/repo';
import InviteLink from '@/components/family-hub/InviteLink';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ circleId: string }>; searchParams: Promise<{ r?: string }> };

const RESULTS: Record<string, { text: string; ok: boolean }> = {
  joined: { text: 'Welcome to the circle.', ok: true },
  already: { text: 'You are already a member of this circle.', ok: true },
  invite: { text: 'Invite link created — copy it below and share it with the adult you are inviting.', ok: true },
  'invite-no': { text: 'That invite could not be created.', ok: false },
  'member-ok': { text: 'Member updated.', ok: true },
  'member-no': { text: 'That change could not be made. The last organizer cannot be removed or demoted.', ok: false },
};

export default async function CirclePage({ params, searchParams }: Props) {
  const ctx = await requireHubAdult();
  const [{ circleId }, { r }] = await Promise.all([params, searchParams]);
  const db = getDb();
  const circle = circleOr404(await getCircle(db, circleId, ctx.account.id));
  const members = (await listMembers(db, circleId, ctx.account.id)) ?? [];
  const activity = await listActivity(db, circleId, ctx.account.id, 10);
  const isOrganizer = circle.role === 'organizer';

  return (
    <>
      <h1>{circle.name}</h1>
      <p>
        <Link href="/family/">Family Hub home</Link> · <Link href={`/family/${circle.id}/calendar/`}>Calendar</Link> ·{' '}
        <Link href={`/family/${circle.id}/runs/`}>Runs board</Link> · <Link href={`/family/${circle.id}/kids/`}>Kids</Link> ·{' '}
        <Link href={`/family/${circle.id}/chores/`}>Chores &amp; points</Link> · <Link href={`/family/${circle.id}/rewards/`}>Rewards</Link> ·{' '}
        <Link href={`/family/${circle.id}/meals/`}>Meals</Link>
      </p>
      {r && RESULTS[r] && (
        <p id="result" role={RESULTS[r].ok ? undefined : 'alert'}>
          {RESULTS[r].text}
        </p>
      )}
      <InviteLink />
      <h2>Adults in this circle</h2>
      <ul className="admin-list">
        {members.map((m) => (
          <li key={m.userId}>
            {m.email} — {m.role}
            {isOrganizer && m.userId !== ctx.account.id && (
              <>
                {' '}
                <form method="post" action={`/family/${circle.id}/members/act/`} style={{ display: 'inline' }}>
                  <input type="hidden" name="user_id" value={m.userId} />
                  <input type="hidden" name="action" value="role" />
                  <input type="hidden" name="role" value={m.role === 'organizer' ? 'member' : 'organizer'} />
                  <button type="submit">{m.role === 'organizer' ? 'Make member' : 'Make organizer'}</button>
                </form>{' '}
                <form method="post" action={`/family/${circle.id}/members/act/`} style={{ display: 'inline' }}>
                  <input type="hidden" name="user_id" value={m.userId} />
                  <input type="hidden" name="action" value="remove" />
                  <button type="submit">Remove</button>
                </form>
              </>
            )}
          </li>
        ))}
      </ul>
      <h2>Invite an adult</h2>
      <p>
        Invite links work once and expire in 7 days. Only invite adults you trust with the family schedule — anyone with the link
        (signed in as the invited address, if you give one) joins as a member.
      </p>
      <form method="post" action={`/family/${circle.id}/members/invite/`}>
        <p>
          <label>
            Their email (optional — binds the link to that address)
            <br />
            <input name="email" type="email" maxLength={254} />
          </label>
        </p>
        <button type="submit">Create invite link</button>
      </form>
      <h2>Privacy</h2>
      <p>
        Everything in this circle — schedule, runs, kid profiles — is visible only to the adults listed above. It is never shown to
        sponsors, never used for advertising, and children never get accounts or logins.
      </p>
      {activity && activity.length > 0 && (
        <>
          <h2>Recent activity</h2>
          <ul className="admin-list">
            {activity.map((a, i) => (
              <li key={i}>
                {a.message} <small>({a.createdAt.toLocaleString('en-US', { timeZone: circle.timeZone })})</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
