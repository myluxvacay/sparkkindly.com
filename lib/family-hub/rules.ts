// Family Hub rules (Phase 1, scope §2–§4): pure constants and helpers — no database, no Next.js.
// Verified by tests/unit/family-hub.test.ts.

// The site's child bands plus the Hub-only teen band. Rideshare eligibility turns on '13-17';
// the site's content banding (lib/age-bands.ts) is deliberately untouched.
export const HUB_AGE_GROUPS = ['3-5', '6-8', '9-12', '13-17'] as const;
export type HubAgeGroup = (typeof HUB_AGE_GROUPS)[number];

export const HUB_AGE_LABEL: Record<HubAgeGroup, string> = {
  '3-5': 'Ages 3–5',
  '6-8': 'Ages 6–8',
  '9-12': 'Ages 9–12',
  '13-17': 'Ages 13–17 (teen)',
};

export const isHubAgeGroup = (v: unknown): v is HubAgeGroup =>
  typeof v === 'string' && (HUB_AGE_GROUPS as readonly string[]).includes(v);

// Starter avatar set: built-in illustrated ids only — never a photo upload (scope §3).
export const AVATARS = ['spark', 'mango', 'dog', 'owl', 'fox', 'bear', 'bunny', 'rocket'] as const;
export type AvatarId = (typeof AVATARS)[number];
export const isAvatarId = (v: unknown): v is AvatarId => typeof v === 'string' && (AVATARS as readonly string[]).includes(v);

export const COLOURS = ['purple', 'teal', 'coral', 'amber', 'green', 'blue', 'pink', 'slate'] as const;
export type HubColour = (typeof COLOURS)[number];
export const isColour = (v: unknown): v is HubColour => typeof v === 'string' && (COLOURS as readonly string[]).includes(v);

export const COLOUR_HEX: Record<HubColour, string> = {
  purple: '#6d28d9',
  teal: '#0f766e',
  coral: '#e11d48',
  amber: '#d97706',
  green: '#15803d',
  blue: '#2563eb',
  pink: '#db2777',
  slate: '#475569',
};

export const LIMITS = { circlesPerUser: 10, membersPerCircle: 12, kidsPerCircle: 12, eventsPerCircle: 1000 } as const;

export const cleanName = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s+/g, ' ');
  return s.length >= 1 && s.length <= max ? s : null;
};

export type PhoneParse = { ok: true; phone: string | null } | { ok: false };
// Empty input is a valid "no phone"; anything else must look like a phone number.
export const parsePhone = (v: unknown): PhoneParse => {
  if (v === null || v === undefined) return { ok: true, phone: null };
  if (typeof v !== 'string') return { ok: false };
  const s = v.trim();
  if (s === '') return { ok: true, phone: null };
  return /^[+0-9][0-9\s().-]{4,23}$/.test(s) ? { ok: true, phone: s } : { ok: false };
};

// The 13-17-only ride rule (scope §M2): no ride handoff is ever offered for a younger profile,
// and standard Uber/Lyft never carries an unaccompanied under-18 outside the teen products.
export const rideEligible = (ageGroup: string): boolean => ageGroup === '13-17';

export const AFFILIATE_DISCLOSURE = 'SparkKindly may earn a commission if you sign up with a rideshare service from here.';

// Handoff links. Uber's universal link accepts a prefilled drop-off address; Lyft's public web
// booking does not document one, so Lyft gets a plain link (the parent enters the destination).
export function rideLinks(destination: string | null): { uber: string; lyft: string } {
  const uber = new URL('https://m.uber.com/ul/');
  uber.searchParams.set('action', 'setPickup');
  uber.searchParams.set('pickup', 'my_location');
  if (destination) uber.searchParams.set('dropoff[formatted_address]', destination);
  return { uber: uber.toString(), lyft: 'https://ride.lyft.com/' };
}

export type Recurrence = 'weekly' | null;

export type EventLike = {
  startsAt: Date;
  recurrence: Recurrence;
  recurrenceUntil: Date | null; // a date (UTC midnight) or null
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Interpret a `datetime-local` value ("2026-11-27T15:30") as wall-clock time in an IANA zone
// and return the UTC instant. Falls back to UTC for an unknown zone.
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(guess));
    const p: Record<string, number> = {};
    for (const part of parts) if (part.type !== 'literal') p[part.type] = Number(part.value);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return new Date(guess - (asUtc - guess));
  } catch {
    return new Date(guess);
  }
}

// The UTC range [start, end) of one calendar day in an IANA zone.
export function zonedDayRange(day: Date, timeZone: string): { from: Date; to: Date } {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [y, mo, d] = fmt.format(day).split('-').map(Number);
  const from = zonedLocalToUtc(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00`, timeZone) ?? new Date(Date.UTC(y, mo - 1, d));
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

// Occurrence start instants of an event inside [from, to). Non-recurring: the start itself.
// Weekly: step 7 days from the start, honouring recurrenceUntil (inclusive, by UTC date).
export function expandOccurrences(e: EventLike, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  if (!e.recurrence) {
    if (e.startsAt >= from && e.startsAt < to) out.push(e.startsAt);
    return out;
  }
  let t = e.startsAt.getTime();
  const untilMs = e.recurrenceUntil ? Date.UTC(e.recurrenceUntil.getUTCFullYear(), e.recurrenceUntil.getUTCMonth(), e.recurrenceUntil.getUTCDate(), 23, 59, 59, 999) : null;
  // Skip ahead in whole weeks when the series starts long before the window.
  if (t < from.getTime()) {
    const skip = Math.floor((from.getTime() - t) / WEEK_MS);
    t += skip * WEEK_MS;
  }
  for (let i = 0; i < 520 && t < to.getTime(); i++, t += WEEK_MS) {
    if (untilMs !== null && t > untilMs) break;
    if (t >= from.getTime()) out.push(new Date(t));
  }
  return out;
}
