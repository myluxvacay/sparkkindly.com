// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ageGroupFor, can, POLICY, type AgeGroup, type Capability } from '@/lib/accounts/policy';

const NOW = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('ageGroupFor', () => {
  it('exposes the policy ages', () => {
    expect(POLICY).toEqual({ minAge: 13, consentAge: 16, adultAge: 18 });
  });

  it.each([
    ['2013-06-15', '2026-06-14', 'under_13'],
    ['2013-06-15', '2026-06-15', 'teen_13_15'],
    ['2010-06-15', '2026-06-14', 'teen_13_15'],
    ['2010-06-15', '2026-06-15', 'teen_16_17'],
    ['2008-06-15', '2026-06-14', 'teen_16_17'],
    ['2008-06-15', '2026-06-15', 'adult'],
  ])('dob %s on %s is %s', (dob, today, group) => {
    expect(ageGroupFor(dob, NOW(today))).toBe(group);
  });

  // Fail closed: the birthday only counts once it has begun everywhere on Earth (UTC-12), i.e. at 12:00 UTC.
  it.each([
    ['2013-06-15', '2026-06-15T11:59:59Z', 'under_13'],
    ['2013-06-15', '2026-06-15T12:00:00Z', 'teen_13_15'],
    ['2010-06-15', '2026-06-15T11:59:59Z', 'teen_13_15'],
    ['2010-06-15', '2026-06-15T12:00:00Z', 'teen_16_17'],
    ['2008-06-15', '2026-06-15T11:59:59Z', 'teen_16_17'],
    ['2008-06-15', '2026-06-15T12:00:00Z', 'adult'],
    ['2013-06-15', '2026-06-15T00:00:00Z', 'under_13'],
  ])('dob %s at %s is %s', (dob, at, group) => {
    expect(ageGroupFor(dob, new Date(at))).toBe(group);
  });

  it('a date of birth equal to the UTC date is valid (not future), even before 12:00 UTC', () => {
    expect(ageGroupFor('2026-11-03', new Date('2026-11-03T01:00:00Z'))).toBe('under_13');
    expect(ageGroupFor('2026-11-04', new Date('2026-11-03T23:00:00Z'))).toBeNull();
  });

  it('counts a 29 February birth from 1 March in a non-leap year', () => {
    expect(ageGroupFor('2012-02-29', NOW('2025-02-28'))).toBe('under_13');
    expect(ageGroupFor('2012-02-29', NOW('2025-03-01'))).toBe('teen_13_15');
  });

  it('returns null for future, pre-1900, malformed and impossible dates', () => {
    expect(ageGroupFor('2027-01-01', NOW('2026-11-03'))).toBeNull();
    expect(ageGroupFor('1899-12-31', NOW('2026-11-03'))).toBeNull();
    expect(ageGroupFor('not a date', NOW('2026-11-03'))).toBeNull();
    expect(ageGroupFor('2010-02-30', NOW('2026-11-03'))).toBeNull();
  });
});

const ALL: Capability[] = [
  'save_interests',
  'join_circle',
  'create_circle',
  'public_comment',
  'join_community',
  'contribute',
  'create_child_profile',
  'see_sponsorship',
  'essential_email',
  'marketing_email',
];
const without = (...no: Capability[]) => ALL.filter((c) => !no.includes(c));

describe('can', () => {
  const rows: [AgeGroup, 'none' | 'pending' | 'confirmed', Capability[]][] = [
    ['under_13', 'none', []],
    ['under_13', 'confirmed', []],
    ['teen_13_15', 'none', []],
    ['teen_13_15', 'pending', ['save_interests', 'essential_email']],
    ['teen_13_15', 'confirmed', ['save_interests', 'essential_email', 'join_circle', 'create_circle']],
    ['teen_16_17', 'none', without('create_child_profile', 'see_sponsorship')],
    ['adult', 'none', ALL],
  ];
  it.each(rows)('%s / %s', (group, consent, allowed) => {
    for (const cap of ALL) {
      expect(can(group, consent, cap), `${group}/${consent}/${cap}`).toBe(allowed.includes(cap));
    }
  });
});
