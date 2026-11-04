// Account sign-up with age gating (design spec 4a.5). No Next.js imports; verified by tests/unit/account-signup.test.ts.
// An under-13 date of birth writes nothing and logs nothing.
import type { Db } from '@/lib/db';
import { ageGroupFor } from './policy';

export type SignUpInput = { email: unknown; dateOfBirth: unknown; parentEmail?: unknown; timeZone?: unknown };
export type SignUpResult =
  | { status: 'created'; accountId: string }
  | { status: 'under_13' | 'invalid' | 'parent_required' | 'exists' };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZONES = new Set<string>(Intl.supportedValuesOf('timeZone'));

function cleanEmail(v: unknown): string | null {
  if (typeof v !== 'string') {
    return null;
  }
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

function cleanZone(v: unknown): string {
  return typeof v === 'string' && (v === 'UTC' || ZONES.has(v)) ? v : 'UTC';
}

export async function signUp(db: Db, input: SignUpInput, now: Date): Promise<SignUpResult> {
  const email = cleanEmail(input.email);
  const group = typeof input.dateOfBirth === 'string' ? ageGroupFor(input.dateOfBirth, now) : null;
  if (!email || !group) {
    return { status: 'invalid' };
  }
  if (group === 'under_13') {
    return { status: 'under_13' };
  }
  let parent: string | null = null;
  if (group === 'teen_13_15') {
    parent = cleanEmail(input.parentEmail);
    if (!parent || parent === email) {
      return { status: 'parent_required' };
    }
  }
  return db.transaction(async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO accounts (email, date_of_birth, time_zone, consent_state, parent_email)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [email, input.dateOfBirth, cleanZone(input.timeZone), parent ? 'pending' : 'none', parent],
    );
    return r.rows[0] ? ({ status: 'created', accountId: r.rows[0].id } as const) : ({ status: 'exists' } as const);
  });
}
