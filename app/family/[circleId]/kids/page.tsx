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
