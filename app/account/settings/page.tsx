import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdult } from '@/lib/accounts/next';
import { hasPin } from '@/lib/accounts/pin';
import { consentPending } from '@/lib/accounts/policy';
import { getSettings, TIME_ZONES } from '@/lib/accounts/settings';
import { getDb } from '@/lib/db';
import { PinInput } from '@/components/PinInput';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Settings' };

type Props = { searchParams: Promise<{ r?: string }> };

// Outcome codes from the POSTs, and which form an error belongs to.
const RESULTS: Record<string, { text: string; ok: boolean; form?: 'prefs' | 'pin' }> = {
  saved: { text: 'Your settings are saved.', ok: true },
  pending: { text: 'These settings are available after your parent or guardian confirms.', ok: false, form: 'prefs' },
  invalid: { text: 'Please choose a time zone from the list, then save again.', ok: false, form: 'prefs' },
  'pin-reset': { text: 'Your new PIN is set.', ok: true },
  'pin-stale': {
    text: 'For safety, sign in again with an email link, then set a new PIN straight away.',
    ok: false,
    form: 'pin',
  },
  'pin-invalid': { text: 'The new PIN must be 4 digits, entered the same twice.', ok: false, form: 'pin' },
};

function Result({ code }: { code?: string }) {
  const r = code ? RESULTS[code] : undefined;
  if (!r) return null;
  return (
    <div role={r.ok ? 'status' : 'alert'} id="result" tabIndex={-1} className={r.ok ? 'takeaway' : 'grown-ups'}>
      <p>{r.text}</p>
    </div>
  );
}

type Prefs = NonNullable<Awaited<ReturnType<typeof getSettings>>>;

// A consent-pending 13-15 account saves interests only (spec 4a.5): the form shows, disabled, with the reason.
function PrefsForm({ settings, error, pending }: { settings: Prefs; error: boolean; pending: boolean }) {
  const zones = TIME_ZONES.includes(settings.timeZone) ? TIME_ZONES : [settings.timeZone, ...TIME_ZONES];
  return (
    <form method="post" action="/account/settings/save/" className="prose admin-form">
      <h2>Emails and time zone</h2>
      {pending && <p id="pending-hint">These settings are available after your parent or guardian confirms.</p>}
      <fieldset aria-describedby="notify-hint" disabled={pending}>
        <legend>Email me when</legend>
        <p id="notify-hint">Circle emails go to circle members only, and only for the choices ticked here. Every one has an unsubscribe link.</p>
        <label className="admin-radio">
          <input type="checkbox" name="daily_set" defaultChecked={settings.notify.dailySet} /> Daily set ready
        </label>
        <label className="admin-radio">
          <input type="checkbox" name="weekly" defaultChecked={settings.notify.weeklyCircle} /> Weekly circle summary
        </label>
        <label className="admin-radio">
          <input type="checkbox" name="invites" defaultChecked={settings.notify.invites} /> Invites
        </label>
      </fieldset>
      <p>
        <label htmlFor="time_zone">Time zone</label>
        <select
          id="time_zone"
          name="time_zone"
          defaultValue={settings.timeZone}
          disabled={pending}
          aria-describedby={error ? 'result' : undefined}
          aria-invalid={error || undefined}
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </p>
      <button type="submit" className="button" disabled={pending} aria-describedby={pending ? 'pending-hint' : undefined}>
        Save settings
      </button>
    </form>
  );
}

function PinResetForm({ error }: { error: boolean }) {
  const described = error ? 'result' : undefined;
  return (
    <form method="post" action="/account/settings/pin/" className="prose admin-form">
      <h2>Forgotten your PIN?</h2>
      <p id="pin-reset-hint">
        You can set a new PIN without the old one within 10 minutes of signing in with an email link.
      </p>
      <PinInput id="new_pin" label="New PIN (4 digits)" describedBy={['pin-reset-hint', described]} />
      <PinInput id="new_pin_confirm" label="New PIN again" describedBy={['pin-reset-hint', described]} />
      <button type="submit" className="button">
        Set the new PIN
      </button>
    </form>
  );
}

// Adult context only (requireAdult): a child context goes to the "Playing as" page.
export default async function SettingsPage({ searchParams }: Props) {
  const { account } = await requireAdult();
  const { r } = await searchParams;
  const db = getDb();
  const [settings, pinSet] = await Promise.all([getSettings(db, account.id), hasPin(db, account.id)]);
  const errorFor = r ? RESULTS[r]?.form : undefined;
  return (
    <>
      <h1>Settings</h1>
      <Result code={r} />
      {settings && (
        <PrefsForm
          settings={settings}
          error={errorFor === 'prefs'}
          pending={consentPending(account.ageGroup, account.consent)}
        />
      )}
      <form method="post" action="/account/settings/export/" className="prose admin-form">
        <h2>Your data</h2>
        <p>Download everything we hold about your account and its child profiles, as one JSON file.</p>
        <button type="submit" className="button">
          Download my data
        </button>
      </form>
      {pinSet && <PinResetForm error={errorFor === 'pin'} />}
      <div className="prose">
        <h2>Delete your account</h2>
        <p>
          <Link href="/account/settings/delete/">Delete your account and everything in it</Link>
        </p>
      </div>
      <p>
        <Link href="/account/">Back to your account</Link>
      </p>
    </>
  );
}
