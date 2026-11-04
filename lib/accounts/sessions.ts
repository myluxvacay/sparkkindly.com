// Member sign-in: an emailed single-use link, then a session. Separate tables and tokens from admin sign-in, so neither
// kind of session is ever valid for the other. Tokens are random, sent to the client once, stored only as sha256 hashes.
// The link host comes from config (linkBase in lib/admin/sessions.ts), never the request. No Next.js imports.
// Verified by tests/unit/account-sessions.test.ts.
import type { Db, Queryable } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { hash, newToken } from '@/lib/tokens';
import type { AgeBand } from './children';
import { ageGroupFor, type AgeGroup, type Consent } from './policy';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const LINK_TTL = 15 * MIN;
const IDLE_TTL = 30 * DAY;
const MAX_TTL = 90 * DAY;

const later = (now: Date, ms: number) => new Date(now.getTime() + ms).toISOString();

export type AccountView = { id: string; email: string; ageGroup: AgeGroup; consent: Consent; consentAt: Date | null };

// Whether an address has an account, and whether it has ever signed in (verified), or null for no account.
export async function accountStatus(db: Queryable, email: string): Promise<'verified' | 'unverified' | null> {
  const r = await db.query<{ verified: boolean }>('SELECT verified_at IS NOT NULL AS verified FROM accounts WHERE email = $1', [
    email,
  ]);
  const row = r.rows[0];
  return row ? (row.verified ? 'verified' : 'unverified') : null;
}

// A single-use link token for a known address, or null (and nothing written) for an unknown one. The route answers
// identically either way. `env` is accepted for symmetry with admin sign-in; the link host is applied by the caller.
export async function requestAccountLink(db: Queryable, email: string, _env: EnvLike, now: Date): Promise<string | null> {
  if (typeof email !== 'string') {
    return null;
  }
  const e = email.trim().toLowerCase();
  const known = await db.query('SELECT 1 FROM accounts WHERE email = $1', [e]);
  if (known.rows.length !== 1) {
    return null;
  }
  const token = newToken();
  await db.query('INSERT INTO account_login_tokens (token_hash, email, expires_at) VALUES ($1, $2, $3)', [
    hash(token),
    e,
    later(now, LINK_TTL),
  ]);
  return token;
}

// True when the address already has an unused, unexpired link minted in the last 60 seconds (a link lives 15 minutes,
// so its expiry is still more than 14 minutes away). The caller then sends nothing: one person cannot have a victim's
// inbox flooded, and the response is the same either way.
export async function hasFreshLink(db: Queryable, email: string, now: Date): Promise<boolean> {
  const r = await db.query(
    'SELECT 1 FROM account_login_tokens WHERE email = $1 AND used_at IS NULL AND expires_at > $2::timestamptz LIMIT 1',
    [email, later(now, LINK_TTL - MIN)],
  );
  return r.rows.length > 0;
}

export type LinkTarget = {
  email: string;
  verified: boolean;
  ageGroup: AgeGroup | null;
  consent: Consent;
  parentEmail: string | null;
};

// What a still-valid, unused link would sign in, without using it up (the confirm page shows it), or null.
export async function linkTarget(db: Queryable, token: string, now: Date): Promise<LinkTarget | null> {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    return null;
  }
  const r = await db.query<{
    email: string;
    verified: boolean;
    dob: string;
    consent_state: Consent;
    parent_email: string | null;
  }>(
    `SELECT a.email, a.verified_at IS NOT NULL AS verified, to_char(a.date_of_birth, 'YYYY-MM-DD') AS dob,
            a.consent_state, a.parent_email
     FROM account_login_tokens t JOIN accounts a ON a.email = t.email
     WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > $2::timestamptz`,
    [hash(token), now.toISOString()],
  );
  const row = r.rows[0];
  if (!row) {
    return null;
  }
  return {
    email: row.email,
    verified: row.verified,
    ageGroup: ageGroupFor(row.dob, now),
    consent: row.consent_state,
    parentEmail: row.parent_email,
  };
}

// Uses up a link and starts a session. Returns the session token, or null. One transaction that first locks the
// account row (FOR UPDATE): a replacing sign-up (signUp's upsert also takes that row lock and revokes the address's
// unused links) runs wholly before it, so the link is gone and this returns null, or wholly after it, when the account
// is verified and the sign-up changes nothing. The link check runs after the lock, on a fresh snapshot.
export async function consumeAccountLink(db: Db, token: string, now: Date): Promise<string | null> {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    return null;
  }
  const h = hash(token);
  const at = now.toISOString();
  return db.transaction(async (tx) => {
    const account = await tx.query<{ id: string }>(
      'SELECT id FROM accounts WHERE email = (SELECT email FROM account_login_tokens WHERE token_hash = $1) FOR UPDATE',
      [h],
    );
    const id = account.rows[0]?.id;
    if (!id) {
      return null;
    }
    const used = await tx.query(
      `UPDATE account_login_tokens SET used_at = $2
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2::timestamptz`,
      [h, at],
    );
    if (used.rowCount !== 1) {
      return null;
    }
    // A sign-in is recorded on the account (sessions are purged once expired) and clears any inactivity notice
    // (lib/accounts/inactivity.ts), so the account is kept.
    await tx.query(
      `UPDATE accounts SET verified_at = COALESCE(verified_at, $2::timestamptz), last_sign_in_at = $2::timestamptz,
         inactivity_notice_at = NULL
       WHERE id = $1`,
      [id, at],
    );
    const session = newToken();
    await tx.query(
      `INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $3)`,
      [hash(session), id, at, later(now, IDLE_TTL)],
    );
    return session;
  });
}

export type ActiveProfile = { id: string; displayName: string; ageBand: AgeBand };
export type SessionView = { account: AccountView; profile: ActiveProfile | null };

// The adult account behind this session token, or null. Null too while a child profile is active: every existing
// settings page and route goes through here, so a child context fails closed on all of them (lib/accounts/context.ts
// is the child-aware entry point).
export async function getAccount(db: Queryable, sessionToken: string, now: Date): Promise<AccountView | null> {
  const s = await sessionView(db, sessionToken, now);
  return s && !s.profile ? s.account : null;
}

// The signed-in account and its active child profile (read from the session row, joined on the session's own account)
// for this session token, or null. The age group is re-derived from the date of birth on every call, and an unknown or
// under-13 result fails closed. Using a session pushes its expiry out 30 days, never past 90 days from creation.
export async function sessionView(db: Queryable, sessionToken: string, now: Date): Promise<SessionView | null> {
  if (typeof sessionToken !== 'string' || !/^[0-9a-f]{64}$/.test(sessionToken)) {
    return null;
  }
  const h = hash(sessionToken);
  const r = await db.query<{
    id: string;
    email: string;
    dob: string;
    consent_state: Consent;
    consent_at: Date | null;
    created_at: Date;
    last_seen_at: Date;
    profile_id: string | null;
    display_name: string | null;
    age_band: AgeBand | null;
  }>(
    `SELECT a.id, a.email, to_char(a.date_of_birth, 'YYYY-MM-DD') AS dob, a.consent_state, a.consent_at, s.created_at, s.last_seen_at,
            p.id AS profile_id, p.display_name, p.age_band
     FROM account_sessions s JOIN accounts a ON a.id = s.account_id
     LEFT JOIN child_profiles p ON p.id = s.active_profile_id AND p.account_id = s.account_id
     WHERE s.token_hash = $1 AND s.expires_at > $2::timestamptz`,
    [h, now.toISOString()],
  );
  const row = r.rows[0];
  if (!row) {
    return null;
  }
  const ageGroup = ageGroupFor(row.dob, now);
  if (!ageGroup || ageGroup === 'under_13') {
    return null;
  }
  if (now.getTime() - new Date(row.last_seen_at).getTime() > MIN) {
    const cap = new Date(row.created_at).getTime() + MAX_TTL;
    await db.query('UPDATE account_sessions SET last_seen_at = $2, expires_at = $3 WHERE token_hash = $1', [
      h,
      now.toISOString(),
      new Date(Math.min(now.getTime() + IDLE_TTL, cap)).toISOString(),
    ]);
  }
  return {
    account: {
      id: row.id,
      email: row.email,
      ageGroup,
      consent: row.consent_state,
      consentAt: row.consent_at ? new Date(row.consent_at) : null,
    },
    profile: row.profile_id ? { id: row.profile_id, displayName: row.display_name!, ageBand: row.age_band! } : null,
  };
}

export async function endAccountSession(db: Queryable, sessionToken: string): Promise<void> {
  if (typeof sessionToken === 'string' && sessionToken) {
    await db.query('DELETE FROM account_sessions WHERE token_hash = $1', [hash(sessionToken)]);
  }
}
