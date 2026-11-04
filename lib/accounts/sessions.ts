// Member sign-in: an emailed single-use link, then a session. Separate tables and tokens from admin sign-in, so neither
// kind of session is ever valid for the other. Tokens are random, sent to the client once, stored only as sha256 hashes.
// The link host comes from config (linkBase in lib/admin/sessions.ts), never the request. No Next.js imports.
// Verified by tests/unit/account-sessions.test.ts.
import type { Queryable } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { hash, newToken } from '@/lib/tokens';
import { ageGroupFor, type AgeGroup, type Consent } from './policy';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const LINK_TTL = 15 * MIN;
const IDLE_TTL = 30 * DAY;
const MAX_TTL = 90 * DAY;

const later = (now: Date, ms: number) => new Date(now.getTime() + ms).toISOString();

export type AccountView = { id: string; email: string; ageGroup: AgeGroup; consent: Consent };

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

// Uses up a link and starts a session. Returns the session token, or null.
export async function consumeAccountLink(db: Queryable, token: string, now: Date): Promise<string | null> {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    return null;
  }
  const used = await db.query<{ email: string }>(
    `UPDATE account_login_tokens SET used_at = $2
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2::timestamptz RETURNING email`,
    [hash(token), now.toISOString()],
  );
  const email = used.rows[0]?.email;
  if (!email) {
    return null;
  }
  const session = newToken();
  const r = await db.query(
    `INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at, last_seen_at)
     SELECT $1, id, $2, $3, $2 FROM accounts WHERE email = $4`,
    [hash(session), now.toISOString(), later(now, IDLE_TTL), email],
  );
  return r.rowCount === 1 ? session : null;
}

// The signed-in account for this session token, or null. The age group is re-derived from the date of birth on every
// call, and an unknown or under-13 result fails closed. Using a session pushes its expiry out 30 days, never past 90
// days from creation.
export async function getAccount(db: Queryable, sessionToken: string, now: Date): Promise<AccountView | null> {
  if (typeof sessionToken !== 'string' || !/^[0-9a-f]{64}$/.test(sessionToken)) {
    return null;
  }
  const h = hash(sessionToken);
  const r = await db.query<{
    id: string;
    email: string;
    dob: string;
    consent_state: Consent;
    created_at: Date;
    last_seen_at: Date;
  }>(
    `SELECT a.id, a.email, to_char(a.date_of_birth, 'YYYY-MM-DD') AS dob, a.consent_state, s.created_at, s.last_seen_at
     FROM account_sessions s JOIN accounts a ON a.id = s.account_id
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
  return { id: row.id, email: row.email, ageGroup, consent: row.consent_state };
}

export async function endAccountSession(db: Queryable, sessionToken: string): Promise<void> {
  if (typeof sessionToken === 'string' && sessionToken) {
    await db.query('DELETE FROM account_sessions WHERE token_hash = $1', [hash(sessionToken)]);
  }
}
