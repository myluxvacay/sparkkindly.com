// Account sign-up with age gating (design spec 4a.5). No Next.js imports; verified by tests/unit/account-signup.test.ts.
// A sign-up for an address nobody has signed in to yet replaces that row (latest wins); a verified account is never
// changed (status 'exists'). One atomic statement, so two racing sign-ups cannot interleave.
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
    const r = await tx.query<{ id: string; replaced: boolean }>(
      `INSERT INTO accounts (email, date_of_birth, time_zone, consent_state, parent_email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET date_of_birth = EXCLUDED.date_of_birth, time_zone = EXCLUDED.time_zone,
         consent_state = EXCLUDED.consent_state, parent_email = EXCLUDED.parent_email
       WHERE accounts.verified_at IS NULL
       RETURNING id, (xmax <> 0) AS replaced`,
      [email, input.dateOfBirth, cleanZone(input.timeZone), parent ? 'pending' : 'none', parent],
    );
    // A replaced row means earlier links were requested against the old details: none may be redeemed now.
    if (r.rows[0]?.replaced) {
      await tx.query('DELETE FROM account_login_tokens WHERE email = $1 AND used_at IS NULL', [email]);
    }
    return r.rows[0] ? ({ status: 'created', accountId: r.rows[0].id } as const) : ({ status: 'exists' } as const);
  });
}
