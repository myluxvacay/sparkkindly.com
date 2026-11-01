import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db, Queryable } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { matchTotp } from './totp';

// Admin sign-in: an emailed link for an allow-listed address, then an authenticator code. Only a session that has
// passed both, whose address is still on the allow-list, and that has not expired is an admin; every request checks
// all of that again (getAdmin). Tokens are random, sent to the client once, and stored only as sha256 hashes.

const MIN = 60_000;
const LINK_TTL = 15 * MIN;
const CODE_STAGE_TTL = 10 * MIN;
const ACTIVE_TTL = 12 * 60 * MIN;
const IDLE_LIMIT = 60 * MIN;
const MAX_CODE_FAILURES = 5;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('hex');
const later = (now: Date, ms: number) => new Date(now.getTime() + ms).toISOString();

export type Admin = { email: string };
export type CodeResult = 'ok' | 'bad' | 'locked' | 'not_enrolled' | 'none';

// ADMIN_EMAILS from the server's env file, comma-separated. Unset or empty allows nobody (fails closed).
export function allowList(env: EnvLike): string[] {
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const isAllowed = (email: string, env: EnvLike): boolean =>
  typeof email === 'string' && email !== '' && allowList(env).includes(email.trim().toLowerCase());

// Returns a single-use link token for an allow-listed address, or null (and writes nothing) for anyone else.
export async function requestLink(db: Queryable, email: string, env: EnvLike, now: Date): Promise<string | null> {
  if (!isAllowed(email, env)) return null;
  const token = newToken();
  await db.query('INSERT INTO admin_login_tokens (token_hash, email, expires_at) VALUES ($1, $2, $3)', [
    hash(token),
    email.trim().toLowerCase(),
    later(now, LINK_TTL),
  ]);
  return token;
}

// Uses up a link token and starts a session at the code stage. Returns the session token, or null.
export async function consumeLink(db: Queryable, token: string, env: EnvLike, now: Date): Promise<string | null> {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
  const r = await db.query<{ email: string }>(
    `UPDATE admin_login_tokens SET used_at = $2
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2::timestamptz RETURNING email`,
    [hash(token), now.toISOString()],
  );
  const email = r.rows[0]?.email;
  if (!email || !isAllowed(email, env)) return null;
  const session = newToken();
  await db.query(
    `INSERT INTO admin_sessions (token_hash, email, stage, created_at, expires_at, last_seen_at)
     VALUES ($1, $2, 'code', $3, $4, $3)`,
    [hash(session), email, now.toISOString(), later(now, CODE_STAGE_TTL)],
  );
  return session;
}

export async function pendingEmail(db: Queryable, sessionToken: string, now: Date): Promise<string | null> {
  if (!sessionToken) return null;
  const r = await db.query<{ email: string }>(
    "SELECT email FROM admin_sessions WHERE token_hash = $1 AND stage = 'code' AND expires_at > $2::timestamptz",
    [hash(sessionToken), now.toISOString()],
  );
  return r.rows[0]?.email ?? null;
}

// Checks the authenticator code for a code-stage session. Five wrong codes end the session. A right code is
// remembered by its step, so it cannot be used again for any session.
export async function submitCode(db: Db, sessionToken: string, code: string, env: EnvLike, now: Date): Promise<CodeResult> {
  if (!sessionToken) return 'none';
  const h = hash(sessionToken);
  return db.transaction(async (tx) => {
    const s = await tx.query<{ email: string; code_failures: number }>(
      `SELECT email, code_failures FROM admin_sessions
       WHERE token_hash = $1 AND stage = 'code' AND expires_at > $2::timestamptz FOR UPDATE`,
      [h, now.toISOString()],
    );
    const session = s.rows[0];
    if (!session || !isAllowed(session.email, env)) return 'none';
    const u = await tx.query<{ totp_secret: string; totp_last_step: string }>(
      'SELECT totp_secret, totp_last_step FROM admin_users WHERE email = $1 FOR UPDATE',
      [session.email],
    );
    const user = u.rows[0];
    if (!user) return 'not_enrolled';
    const step = matchTotp(user.totp_secret, code, now, Number(user.totp_last_step));
    if (step === null) {
      if (session.code_failures + 1 >= MAX_CODE_FAILURES) {
        await tx.query('DELETE FROM admin_sessions WHERE token_hash = $1', [h]);
        return 'locked';
      }
      await tx.query('UPDATE admin_sessions SET code_failures = code_failures + 1 WHERE token_hash = $1', [h]);
      return 'bad';
    }
    await tx.query('UPDATE admin_users SET totp_last_step = $2 WHERE email = $1', [session.email, step]);
    await tx.query(
      "UPDATE admin_sessions SET stage = 'active', expires_at = $2, last_seen_at = $3 WHERE token_hash = $1",
      [h, later(now, ACTIVE_TTL), now.toISOString()],
    );
    return 'ok';
  });
}

// The signed-in admin for this session token, or null. Checked on every admin request.
export async function getAdmin(db: Queryable, sessionToken: string, env: EnvLike, now: Date): Promise<Admin | null> {
  if (!sessionToken) return null;
  const h = hash(sessionToken);
  const r = await db.query<{ email: string; last_seen_at: Date }>(
    `SELECT email, last_seen_at FROM admin_sessions
     WHERE token_hash = $1 AND stage = 'active' AND expires_at > $2::timestamptz AND last_seen_at > $3::timestamptz`,
    [h, now.toISOString(), new Date(now.getTime() - IDLE_LIMIT).toISOString()],
  );
  const row = r.rows[0];
  if (!row || !isAllowed(row.email, env)) return null;
  if (now.getTime() - new Date(row.last_seen_at).getTime() > MIN) {
    await db.query('UPDATE admin_sessions SET last_seen_at = $2 WHERE token_hash = $1', [h, now.toISOString()]);
  }
  return { email: row.email };
}

export async function endSession(db: Queryable, sessionToken: string): Promise<void> {
  if (sessionToken) await db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [hash(sessionToken)]);
}

// The form token for this session: derived from the session token, so it needs no storage and a page from another
// session (or another site) cannot know it.
export const csrfToken = (sessionToken: string): string => hash(`csrf:${sessionToken}`);

export function checkCsrf(sessionToken: string, given: unknown): boolean {
  if (!sessionToken || typeof given !== 'string') return false;
  const want = Buffer.from(csrfToken(sessionToken));
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}
