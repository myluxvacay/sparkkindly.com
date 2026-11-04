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

// Printable ASCII only (no space, one @, a dot in the domain), tested BEFORE lower-casing: JS toLowerCase and Postgres
// lower() agree on ASCII but not on every Unicode letter (final sigma, the Kelvin sign), and lookalikes stay out.
const PART = '[\\x21-\\x3f\\x41-\\x7e]+';
const EMAIL = new RegExp(`^${PART}@${PART}\\.${PART}$`);
const ZONES = new Set<string>(Intl.supportedValuesOf('timeZone'));

// The stored form of an address (trimmed, ASCII-checked, lower-cased), or null. Shared with the sign-in route.
export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== 'string') {
    return null;
  }
  const e = v.trim();
  return e.length <= 254 && EMAIL.test(e) ? e.toLowerCase() : null;
}

const CHECK_VIOLATION = '23514';

function cleanZone(v: unknown): string {
  return typeof v === 'string' && (v === 'UTC' || ZONES.has(v)) ? v : 'UTC';
}

export async function signUp(db: Db, input: SignUpInput, now: Date): Promise<SignUpResult> {
  const email = normalizeEmail(input.email);
  const group = typeof input.dateOfBirth === 'string' ? ageGroupFor(input.dateOfBirth, now) : null;
  if (!email || !group) {
    return { status: 'invalid' };
  }
  if (group === 'under_13') {
    return { status: 'under_13' };
  }
  let parent: string | null = null;
  if (group === 'teen_13_15') {
    parent = normalizeEmail(input.parentEmail);
    if (!parent || parent === email) {
      return { status: 'parent_required' };
    }
  }
  try {
    return await upsert(db, email, input, parent, now);
  } catch (err) {
    // A CHECK the validation above did not foresee (e.g. a case-folding disagreement) is bad input, not a crash.
    if ((err as { code?: unknown }).code === CHECK_VIOLATION) {
      return { status: 'invalid' };
    }
    throw err;
  }
}

function upsert(db: Db, email: string, input: SignUpInput, parent: string | null, now: Date): Promise<SignUpResult> {
  return db.transaction(async (tx) => {
    const r = await tx.query<{ id: string; replaced: boolean }>(
      `INSERT INTO accounts (email, date_of_birth, time_zone, consent_state, parent_email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET date_of_birth = EXCLUDED.date_of_birth, time_zone = EXCLUDED.time_zone,
         consent_state = EXCLUDED.consent_state, parent_email = EXCLUDED.parent_email,
         created_at = $6 -- a replaced row starts its 48 hours again (lib/accounts/retention.ts), so its new link stays live
       WHERE accounts.verified_at IS NULL
       RETURNING id, (xmax <> 0) AS replaced`,
      [email, input.dateOfBirth, cleanZone(input.timeZone), parent ? 'pending' : 'none', parent, now.toISOString()],
    );
    // A replaced row means earlier links were requested against the old details: none may be redeemed now.
    if (r.rows[0]?.replaced) {
      await tx.query('DELETE FROM account_login_tokens WHERE email = $1 AND used_at IS NULL', [email]);
    }
    return r.rows[0] ? ({ status: 'created', accountId: r.rows[0].id } as const) : ({ status: 'exists' } as const);
  });
}
