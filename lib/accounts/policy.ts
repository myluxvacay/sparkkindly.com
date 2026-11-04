// Account policy: age groups and what each may do (design spec 4a.5). Pure functions, no I/O.
// Verified by tests/unit/account-policy.test.ts.

export type AgeGroup = 'under_13' | 'teen_13_15' | 'teen_16_17' | 'adult';

export type Capability =
  | 'save_interests'
  | 'join_circle'
  | 'create_circle'
  | 'public_comment'
  | 'join_community'
  | 'contribute'
  | 'create_child_profile'
  | 'see_sponsorship'
  | 'essential_email'
  | 'marketing_email'
  | 'invite'
  | 'profile_page';

export type Consent = 'none' | 'pending' | 'confirmed';

export const POLICY = { minAge: 13, consentAge: 16, adultAge: 18 } as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const HOURS_12 = 12 * 3_600_000;

// Whole years between a YYYY-MM-DD birth date and now. Fail closed for under-age: the age is taken on the westernmost
// calendar date on Earth (UTC-12, i.e. now minus 12 hours), so nobody passes 13, 16 or 18 before their birthday has
// begun where they live; the birthday counts from 12:00 UTC. A date is "future" only after the UTC date (a dob equal to
// the UTC date is valid; before 12:00 UTC it simply reads as under 13).
// A 29 February birthday falls on 1 March in non-leap years (tuple comparison handles it).
function ageInYears(dob: string, now: Date): number | null {
  const m = ISO_DATE.exec(dob);
  if (!m) {
    return null;
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null;
  }
  if (y < 1900) {
    return null;
  }
  if (dob > now.toISOString().slice(0, 10)) {
    return null;
  }
  const today = new Date(now.getTime() - HOURS_12);
  const ny = today.getUTCFullYear();
  const nm = today.getUTCMonth() + 1;
  const nd = today.getUTCDate();
  const birthdayPassed = nm > mo || (nm === mo && nd >= d);
  return ny - y - (birthdayPassed ? 0 : 1);
}

export function ageGroupFor(dob: string, now: Date): AgeGroup | null {
  const age = ageInYears(dob, now);
  if (age === null) {
    return null;
  }
  if (age < POLICY.minAge) {
    return 'under_13';
  }
  if (age < POLICY.consentAge) {
    return 'teen_13_15';
  }
  if (age < POLICY.adultAge) {
    return 'teen_16_17';
  }
  return 'adult';
}

const TEEN_PENDING: readonly Capability[] = ['save_interests', 'essential_email'];
// 13-15 with consent: circles and invites, but no profile page (spec 4a.5).
const TEEN_CONFIRMED: readonly Capability[] = [...TEEN_PENDING, 'join_circle', 'create_circle', 'invite'];
const ALL: readonly Capability[] = [
  ...TEEN_CONFIRMED,
  'public_comment',
  'join_community',
  'contribute',
  'create_child_profile',
  'see_sponsorship',
  'marketing_email',
  'profile_page',
];
const OLDER_TEEN: readonly Capability[] = ALL.filter((c) => c !== 'create_child_profile' && c !== 'see_sponsorship');

// `can` is necessary, not sufficient: for an adult, create_child_profile ALSO requires a recorded guardian confirmation
// (plan 3C). Never gate child-profile creation on `can` alone.
export function can(group: AgeGroup, consent: Consent, cap: Capability): boolean {
  switch (group) {
    case 'under_13':
      return false;
    case 'teen_13_15':
      if (consent === 'confirmed') {
        return TEEN_CONFIRMED.includes(cap);
      }
      return consent === 'pending' && TEEN_PENDING.includes(cap);
    case 'teen_16_17':
      return OLDER_TEEN.includes(cap);
    case 'adult':
      return ALL.includes(cap);
  }
}

// A 13-15 account whose parent or guardian has not confirmed yet (it can save interests only). Shared by the pages so
// none of them re-derives the rule.
export const consentPending = (group: AgeGroup, consent: Consent): boolean =>
  group === 'teen_13_15' && consent !== 'confirmed';