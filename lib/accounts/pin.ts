// The adult PIN that guards switching out of a child profile: exactly 4 digits, stored only as a scrypt hash with a
// per-account random salt ('salt:hash', hex), compared in constant time. 5 consecutive wrong entries lock entry for
// 15 minutes (per account); a correct entry resets the counter. A PIN is never logged. No Next.js imports.
// Verified by tests/unit/account-pin.test.ts.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Db } from '@/lib/db';

const PIN = /^[0-9]{4}$/;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const KEY_LEN = 32;

const derive = (pin: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(pin, salt, KEY_LEN, (err, key) => (err ? reject(err) : resolve(key))));

export const isPin = (v: unknown): v is string => typeof v === 'string' && PIN.test(v);

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await derive(pin, salt)).toString('hex')}`;
}

async function matches(pin: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex ?? '', 'hex');
  if (!saltHex || expected.length !== KEY_LEN) {
    return false;
  }
  return timingSafeEqual(await derive(pin, Buffer.from(saltHex, 'hex')), expected);
}

// Sets (or changes) the PIN and clears any lockout. 'invalid' when the PIN is not 4 digits or the account is unknown.
export async function setPin(db: Db, accountId: string, pin: unknown): Promise<'set' | 'invalid'> {
  if (!isPin(pin)) {
    return 'invalid';
  }
  const r = await db.query(
    'UPDATE accounts SET pin_hash = $2, pin_failures = 0, pin_locked_until = NULL WHERE id = $1',
    [accountId, await hashPin(pin)],
  );
  return r.rowCount ? 'set' : 'invalid';
}

// Checks a PIN under the account row lock so concurrent guesses cannot skip the counter.
export async function checkPin(db: Db, accountId: string, pin: unknown, now: Date): Promise<'ok' | 'wrong' | 'locked'> {
  return db.transaction(async (tx) => {
    const found = await tx.query<{
      pin_hash: string | null;
      pin_failures: number;
      pin_locked_until: Date | null;
    }>('SELECT pin_hash, pin_failures, pin_locked_until FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
    const a = found.rows[0];
    if (!a?.pin_hash) {
      return 'wrong';
    }
    if (a.pin_locked_until && new Date(a.pin_locked_until).getTime() > now.getTime()) {
      return 'locked';
    }
    if (isPin(pin) && (await matches(pin, a.pin_hash))) {
      if (a.pin_failures !== 0 || a.pin_locked_until) {
        await tx.query('UPDATE accounts SET pin_failures = 0, pin_locked_until = NULL WHERE id = $1', [accountId]);
      }
      return 'ok';
    }
    const failures = a.pin_failures + 1;
    const lock = failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MS).toISOString() : null;
    await tx.query('UPDATE accounts SET pin_failures = $2, pin_locked_until = $3 WHERE id = $1', [
      accountId,
      lock ? 0 : failures,
      lock,
    ]);
    return 'wrong';
  });
}
