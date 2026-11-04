// Resetting a forgotten adult PIN without the old one, allowed only from an adult context whose session was created
// by an email sign-in in the last 10 minutes (proof of the inbox stands in for the PIN). Same 4-digit rule as setPin;
// clears the failure count, the lock and the lock count, and changes nothing else. A PIN is never logged. No Next.js imports.
// Verified by tests/unit/account-pin-reset.test.ts.
import type { Db } from '@/lib/db';
import { hash } from '@/lib/tokens';
import { getContext, requireAdultContext } from './context';
import { hashPin, isPin } from './pin';

const FRESH_MS = 10 * 60_000;

export async function resetPin(
  db: Db,
  sessionToken: string,
  newPin: unknown,
  now: Date,
): Promise<'ok' | 'invalid' | 'stale' | 'not_allowed'> {
  const ctx = requireAdultContext(await getContext(db, sessionToken, now));
  if (!ctx) {
    return 'not_allowed';
  }
  return db.transaction(async (tx) => {
    await tx.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', [ctx.account.id]);
    // Re-read under the lock: the session may have switched to a child profile or ended since getContext.
    const s = await tx.query<{ created_at: Date }>(
      `SELECT created_at FROM account_sessions
       WHERE token_hash = $1 AND account_id = $2 AND active_profile_id IS NULL AND expires_at > $3::timestamptz`,
      [hash(sessionToken), ctx.account.id, now.toISOString()],
    );
    const session = s.rows[0];
    if (!session) {
      return 'not_allowed';
    }
    // Either direction: a session dated in the future (clock skew) must not stay "fresh" for its whole life.
    if (Math.abs(now.getTime() - new Date(session.created_at).getTime()) > FRESH_MS) {
      return 'stale';
    }
    if (!isPin(newPin)) {
      return 'invalid';
    }
    await tx.query(
      'UPDATE accounts SET pin_hash = $2, pin_failures = 0, pin_locked_until = NULL, pin_lock_count = 0 WHERE id = $1',
      [ctx.account.id, await hashPin(newPin)],
    );
    return 'ok';
  });
}
