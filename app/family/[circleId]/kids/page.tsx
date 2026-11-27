import Link from 'next/link';
import { getDb } from '@/lib/db';
import { circleOr404, requireHubAdult } from '@/lib/family-hub/next';
import { getCircle, listKids, type Kid } from '@/lib/family-hub/repo';
import { AVATARS, COLOURS, HUB_AGE_GROUPS, HUB_AGE_LABEL } from '@/lib/family-hub/rules';
import Avatar from '@/components/family-hub/Avatar';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ circleId: string }>; searchParams: Promise<{ r?: string }> };

const RESULTS: Record<string, { text: string; ok: boolean }> = {
  added: { text: 'Profile added.', ok: true },
  saved: { text: 'Profile saved.', ok: true },
  deleted: { text: 'Profile deleted.', ok: true },
  invalid: { text: 'Please check the profile: a first name, a valid age group, and a phone that looks like a phone number.', ok: false },
  limit: { text: 'This circle already has the maximum number of kid profiles.', ok: false },
  pin: { text: 'Kid-view PIN updated.', ok: true },
  'pin-ok': { text: 'Kid-view PIN updated.', ok: true },
  'pin-no': { text: 'That PIN change could not be made — a PIN is 4 to 6 digits.', ok: false },
  no: { text: 'That could not be done.', ok: false },
};

function KidFields({ kid }: { kid?: Kid }) {
  return (
    <>
      <p>
        <label>
          First name
          <br />
          <input name="first_name" required maxLength={30} defaultValue={kid?.firstName ?? ''} />
        </label>
      </p>
      <p>
        <label>
          Age group
          <br />
          <select name="age_group" defaultValue={kid?.ageGroup ?? '6-8'}>
            {HUB_AGE_GROUPS.map((g) => (
              <option key={g} value={g}>
                {HUB_AGE_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          Avatar
          <br />
          <select name="avatar_id" defaultValue={kid?.avatarId ?? 'spark'}>
            {AVATARS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Colour
          <br />
          <select name="colour" defaultValue={kid?.colour ?? 'purple'}>
            {COLOURS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          Phone (optional — usually a teen&rsquo;s own phone, for tap-to-call on run cards)
          <br />
          <input name="phone" type="tel" maxLength={24} defaultValue={kid?.phone ?? ''} />
        </label>
      </p>
      <p>
        <label>
          Dietary / allergy notes (optional — yours, shown only inside the circle at meal-planning time)
          <br />
          <input name="dietary_notes" maxLength={500} defaultValue={kid?.dietaryNotes ?? ''} size={48} />
        </label>
      </p>
    </>
  );
}

export default async function KidsPage({ params, searchParams }: Props) {
  const ctx = await requireHubAdult();
  const [{ circleId }, { r }] = await Promise.all([params, searchParams]);
  const db = getDb();
  const circle = circleOr404(await getCircle(db, circleId, ctx.account.id));
  const kids = (await listKids(db, circleId, ctx.account.id)) ?? [];

  return (
    <>
      <h1>Kids in {circle.name}</h1>
      <p>
        <Link href={`/family/${circle.id}/`}>Circle</Link> · <Link href={`/family/${circle.id}/calendar/`}>Calendar</Link> ·{' '}
        <Link href={`/family/${circle.id}/runs/`}>Runs board</Link>
      </p>
      <p>
        Profiles are managed by parents: first name and age group only, a picture avatar you pick (never a photo), and an optional
        phone. Profiles never become accounts.
      </p>
      {r && RESULTS[r] && (
        <p id="result" role={RESULTS[r].ok ? undefined : 'alert'}>
          {RESULTS[r].text}
        </p>
      )}
      {kids.length === 0 ? (
        <p>No kid profiles yet — add the first one below.</p>
      ) : (
        <ul className="admin-list">
          {kids.map((k) => (
            <li key={k.id} style={{ marginBottom: 16 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Avatar avatarId={k.avatarId} colour={k.colour} name={k.firstName} />
                <strong>{k.firstName}</strong> — {HUB_AGE_LABEL[k.ageGroup]}
                {k.phone ? (
                  <>
                    {' '}
                    · <a href={`tel:${k.phone.replace(/[^+0-9]/g, '')}`}>{k.phone}</a>
                  </>
                ) : null}
              </span>
              <details>
                <summary>Edit profile</summary>
                <form method="post" action={`/family/${circle.id}/kids/update/`}>
                  <input type="hidden" name="kid_id" value={k.id} />
                  <KidFields kid={k} />
                  <button type="submit">Save</button>
                </form>
                <form method="post" action={`/family/${circle.id}/kids/delete/`}>
                  <input type="hidden" name="kid_id" value={k.id} />
                  <button type="submit">Delete profile</button>
                </form>
              </details>
              <details>
                <summary>Kid view (their own page, opened with a PIN)</summary>
                <p>
                  The kid view shows {k.firstName} only their day, their chores, their points and dinner requests — no settings,
                  no phone numbers, nothing to administer. It opens with a 4–6 digit PIN you set; setting a new PIN or clearing
                  it locks the view on every device.{' '}
                  <Link href={`/family/${circle.id}/kid/${k.id}/`}>Open {k.firstName}&rsquo;s kid view</Link>
                </p>
                <form method="post" action={`/family/${circle.id}/kids/pin/`}>
                  <input type="hidden" name="kid_id" value={k.id} />
                  <input type="hidden" name="action" value="set" />
                  <p>
                    <label>
                      {k.hasKidPin ? 'New PIN (replaces the old one)' : 'Set a PIN'}{' '}
                      <input name="pin" type="password" inputMode="numeric" autoComplete="off" required minLength={4} maxLength={6} size={8} />
                    </label>{' '}
                    <button type="submit">{k.hasKidPin ? 'Replace PIN' : 'Set PIN'}</button>
                  </p>
                </form>
                {k.hasKidPin && (
                  <>
                    <form method="post" action={`/family/${circle.id}/kids/pin/`} style={{ display: 'inline' }}>
                      <input type="hidden" name="kid_id" value={k.id} />
                      <input type="hidden" name="action" value="lock" />
                      <button type="submit">Lock kid view everywhere</button>
                    </form>{' '}
                    <form method="post" action={`/family/${circle.id}/kids/pin/`} style={{ display: 'inline' }}>
                      <input type="hidden" name="kid_id" value={k.id} />
                      <input type="hidden" name="action" value="clear" />
                      <button type="submit">Turn kid view off (clear PIN)</button>
                    </form>
                  </>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
      <h2>Add a kid profile</h2>
      <form method="post" action={`/family/${circle.id}/kids/create/`}>
        <KidFields />
        <button type="submit">Add profile</button>
      </form>
    </>
  );
}
