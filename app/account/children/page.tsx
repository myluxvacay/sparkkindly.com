import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listChildProfiles, type ChildProfile } from '@/lib/accounts/children';
import { requireAdult } from '@/lib/accounts/next';
import { hasPin } from '@/lib/accounts/pin';
import { can } from '@/lib/accounts/policy';
import { getDb } from '@/lib/db';
import { PinInput } from '@/components/PinInput';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Child profiles' };

type Props = { searchParams: Promise<{ r?: string }> };

// Outcome codes from the POSTs: which form the message belongs to, and whether it is an error. Wrong and locked PIN
// messages are neutral on purpose (no attempts left, no time remaining).
const RESULTS: Record<string, { text: string; form?: 'create' | 'pin' }> = {
  created: { text: 'The profile is ready.' },
  deleted: { text: 'The profile and everything it held are deleted.' },
  'pin-changed': { text: 'Your PIN is changed.' },
  gone: { text: 'That profile is not available. It may already be deleted.' },
  no: { text: 'Only an adult account can create child profiles.' },
  invalid: { text: 'Please check the name, the age band and the parent or guardian box, then try again.', form: 'create' },
  pin: { text: 'Please choose a 4-digit PIN for switching back.', form: 'create' },
  mismatch: { text: 'The two PINs did not match. Please enter them again.', form: 'create' },
  wrong: { text: 'That PIN was not right. Please try again.', form: 'pin' },
  locked: { text: 'PIN entry is paused after too many tries. Please try again later.', form: 'pin' },
  'pin-invalid': { text: 'The new PIN must be 4 digits, entered the same twice.', form: 'pin' },
};
const SUCCESS = new Set(['created', 'deleted', 'pin-changed']);

const band = (b: ChildProfile['ageBand']) => (b === '6-9' ? 'age 6 to 9' : 'age 10 to 12');

function Result({ code }: { code?: string }) {
  const r = code ? RESULTS[code] : undefined;
  if (!r) return null;
  const ok = SUCCESS.has(code!);
  return (
    <div role={ok ? 'status' : 'alert'} id="result" tabIndex={-1} className={ok ? 'takeaway' : 'grown-ups'}>
      <p>{r.text}</p>
    </div>
  );
}

function ProfileList({ profiles }: { profiles: ChildProfile[] }) {
  if (profiles.length === 0) return <p>No child profiles yet.</p>;
  return (
    <ul className="admin-list">
      {profiles.map((p) => (
        <li key={p.id}>
          <p>
            <strong>{p.displayName}</strong>, {band(p.ageBand)}
          </p>
          <div className="admin-actions">
            <form method="post" action="/account/children/switch/">
              <input type="hidden" name="profile_id" value={p.id} />
              <button type="submit" className="button">
                Play as {p.displayName}
              </button>
            </form>
            <Link href={`/account/children/delete/?profile=${p.id}`}>Delete {p.displayName}&apos;s profile</Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CreateForm({ firstPin, error }: { firstPin: boolean; error: boolean }) {
  const described = error ? 'result' : undefined;
  return (
    <form method="post" action="/account/children/create/" className="prose admin-form">
      <h2>Add a child profile</h2>
      <p>We keep only the name you choose and the age band: no email, birthday, photo or location.</p>
      <p>
        <label htmlFor="display_name">First name or nickname</label>
        <input id="display_name" name="display_name" required maxLength={30} autoComplete="off" aria-describedby={described} />
      </p>
      <fieldset aria-describedby={described}>
        <legend>Age band</legend>
        <label className="admin-radio">
          <input type="radio" name="age_band" value="6-9" required /> 6 to 9
        </label>
        <label className="admin-radio">
          <input type="radio" name="age_band" value="10-12" /> 10 to 12
        </label>
      </fieldset>
      <label className="admin-radio">
        <input type="checkbox" name="guardian" required aria-describedby={described} /> I am this child&apos;s parent or
        guardian
      </label>
      {firstPin && (
        <>
          <p id="pin-hint">Choose a 4-digit PIN. It is needed to switch back from a child profile to your account.</p>
          <PinInput id="pin" label="PIN" describedBy={['pin-hint', described]} />
          <PinInput id="pin_confirm" label="PIN again" describedBy={['pin-hint', described]} />
        </>
      )}
      <button type="submit" className="button">
        Add the profile
      </button>
    </form>
  );
}

function ChangePinForm({ error }: { error: boolean }) {
  const described = error ? 'result' : undefined;
  return (
    <form method="post" action="/account/children/pin/" className="prose admin-form">
      <h2>Change your PIN</h2>
      <PinInput id="current_pin" label="Current PIN" entry describedBy={[described]} />
      <PinInput id="new_pin" label="New PIN (4 digits)" describedBy={[described]} />
      <PinInput id="new_pin_confirm" label="New PIN again" describedBy={[described]} />
      <button type="submit" className="button">
        Change PIN
      </button>
    </form>
  );
}

export default async function ChildProfilesPage({ searchParams }: Props) {
  const { account } = await requireAdult();
  if (!can(account.ageGroup, account.consent, 'create_child_profile')) {
    redirect('/account/');
  }
  const { r } = await searchParams;
  const db = getDb();
  const [profiles, pinSet] = await Promise.all([listChildProfiles(db, account.id), hasPin(db, account.id)]);
  const errorFor = r ? RESULTS[r]?.form : undefined;
  return (
    <>
      <h1>Child profiles</h1>
      <Result code={r} />
      <p>
        A child profile lets a child aged 6 to 12 read and play the Kids world on this device. Switching back to your
        account needs your PIN.
      </p>
      <ProfileList profiles={profiles} />
      <CreateForm firstPin={!pinSet} error={errorFor === 'create'} />
      {pinSet && <ChangePinForm error={errorFor === 'pin'} />}
      <p>
        <Link href="/account/">Back to your account</Link>
      </p>
    </>
  );
}
