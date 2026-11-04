// Retention for account data that belongs to people who never confirmed (an unverified sign-up can carry a third
// party's address or a parent's email) and for spent credentials. Run once per UTC day by the worker (worker/main.ts).
// Never touches a verified account. No Next.js imports; verified by tests/unit/account-retention.test.ts.
import type { Queryable } from '@/lib/db';

const HOUR = 3_600_000;
export const UNVERIFIED_MAX_HOURS = 48;
export const USED_TOKEN_MAX_HOURS = 24;

export type PurgeResult = { accounts: number; tokens: number; sessions: number };

// True once per UTC day: the first caller records the day in job_runs, like the digest and heartbeat claims.
export async function claimAccountPurge(db: Queryable, now: Date): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  const r = await db.query(
    "INSERT INTO job_runs (job, run_key) VALUES ('account-purge', $1) ON CONFLICT DO NOTHING RETURNING run_key",
    [day],
  );
  return r.rows.length === 1;
}

// Deletes unverified accounts older than 48 hours (their sessions cascade), every expired login token and used tokens
// older than a day, and expired sessions. Idempotent.
export async function purgeAccountData(db: Queryable, now: Date): Promise<PurgeResult> {
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const accounts = await db.query('DELETE FROM accounts WHERE verified_at IS NULL AND created_at < $1::timestamptz', [
    at(UNVERIFIED_MAX_HOURS * HOUR),
  ]);
  const tokens = await db.query(
    'DELETE FROM account_login_tokens WHERE expires_at < $1::timestamptz OR used_at < $2::timestamptz',
    [at(0), at(USED_TOKEN_MAX_HOURS * HOUR)],
  );
  const sessions = await db.query('DELETE FROM account_sessions WHERE expires_at < $1::timestamptz', [at(0)]);
  return { accounts: accounts.rowCount ?? 0, tokens: tokens.rowCount ?? 0, sessions: sessions.rowCount ?? 0 };
}
