import type { Metadata } from 'next';
import Link from 'next/link';
import { Result, type Messages } from '@/components/circles/Result';
import { getSettings, TIME_ZONES } from '@/lib/accounts/settings';
import { requireCirclesAdult } from '@/lib/circles/next';
import { KINDS, LIMITS, canCreateKind, type CircleKind } from '@/lib/circles/rules';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Create a circle' };

type Props = { searchParams: Promise<{ r?: string }> };

const MESSAGES: Messages = {
  invalid: {
    text: 'Please check the circle name (up to 40 characters), your name in the circle (up to 30) and the description, then try again.',
    ok: false,
  },
  no: { text: 'Your account cannot create that kind of circle.', ok: false },
  limit: {
    text: `You can own up to ${LIMITS.ownedOpen} open circles and be in up to ${LIMITS.memberOf}. Leave or close one to start another.`,
    ok: false,
  },
};

const EXPLAIN: Record<CircleKind, { label: string; text: string }> = {
  friends: { label: 'Friends', text: 'For friends who want to play together.' },
  family: { label: 'Family', text: 'For a family; adults can add their child profiles. Adults only.' },
  community: { label: 'Community', text: 'For a club or group, with a short description. Adults only.' },
};

export default async function NewCirclePage({ searchParams }: Props) {
  const { account } = await requireCirclesAdult();
  const [{ r }, settings] = await Promise.all([searchParams, getSettings(getDb(), account.id)]);
  const kinds = KINDS.filter((k) => canCreateKind(account.ageGroup, account.consent, k));
  const zone = settings?.timeZone ?? 'UTC';
  const zones = TIME_ZONES.includes(zone) ? TIME_ZONES : [zone, ...TIME_ZONES];
  const described = r && MESSAGES[r] ? 'result' : undefined;
  return (
    <>
      <h1>Create a circle</h1>
      <Result code={r} messages={MESSAGES} />
      {kinds.length === 0 ? (
        <p>Circles are available after your parent or guardian confirms your account.</p>
      ) : (
        <form method="post" action="/circles/create/" className="prose admin-form">
          <p>
            <label htmlFor="name">Circle name</label>
            <input id="name" name="name" required maxLength={LIMITS.name} autoComplete="off" aria-describedby={described} />
          </p>
          <fieldset aria-describedby={described}>
            <legend>Kind of circle</legend>
            {kinds.map((k, i) => (
              <label className="admin-radio" key={k}>
                <input type="radio" name="kind" value={k} required defaultChecked={i === 0} /> {EXPLAIN[k].label}:{' '}
                {EXPLAIN[k].text}
              </label>
            ))}
          </fieldset>
          <p>
            <label htmlFor="your_name">Your name in this circle</label>
            <span id="your-name-hint">Other members see this name, never your email. A first name or nickname is best.</span>
            <input
              id="your_name"
              name="your_name"
              required
              maxLength={LIMITS.memberName}
              autoComplete="off"
              aria-describedby={['your-name-hint', described].filter(Boolean).join(' ')}
            />
          </p>
          <p>
            <label htmlFor="time_zone">Circle time zone</label>
            <select id="time_zone" name="time_zone" defaultValue={zone}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </p>
          {kinds.includes('community') && (
            <p>
              <label htmlFor="description">Description (community circles only)</label>
              <textarea id="description" name="description" maxLength={LIMITS.description} rows={3} />
            </p>
          )}
          <button type="submit" className="button">
            Create the circle
          </button>
        </form>
      )}
      <p>
        <Link href="/circles/">Back to your circles</Link>
      </p>
    </>
  );
}
