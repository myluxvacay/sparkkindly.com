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
  | 'marketing_email';

export type Consent = 'none' | 'pending' | 'confirmed';

export const POLICY = { minAge: 13, consentAge: 16, adultAge: 18 } as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Whole years between a YYYY-MM-DD birth date and now, on UTC calendar dates.
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
  const ny = now.getUTCFullYear();
  const nm = now.getUTCMonth() + 1;
  const nd = now.getUTCDate();
  if (y > ny || (y === ny && (mo > nm || (mo === nm && d > nd)))) {
    return null;
  }
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
const TEEN_CONFIRMED: readonly Capability[] = [...TEEN_PENDING, 'join_circle', 'create_circle'];
const ALL: readonly Capability[] = [
  ...TEEN_CONFIRMED,
  'public_comment',
  'join_community',
  'contribute',
  'create_child_profile',
  'see_sponsorship',
  'marketing_email',
];
const OLDER_TEEN: readonly Capability[] = ALL.filter((c) => c !== 'create_child_profile' && c !== 'see_sponsorship');

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
