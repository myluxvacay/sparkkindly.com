// Kid-view credentials (Phase 2). The kid view is a PIN-return surface on a family device:
// it is NOT the account system. A kid-view session is an opaque token of its own, stored
// hashed in hub_kid_view_sessions and bound to exactly one (circle, kid profile). It is
// minted only by entering that profile's PIN, it expires after 12 hours, and it is revoked
// wholesale when a parent sets/clears the PIN or locks the view. The kid data layer takes
// its (circle, kid) from this token and from nothing else; the parent data layer never
// reads this cookie, and this module never reads the account cookie — so a kid-view
// session cannot reach a parent route, and an account session is never needed (or used)
// on a kid route. PIN hashes use the account system's scrypt 'salt:hash' format
// (lib/accounts/pin.ts); the lockout mirrors it (5 wrong entries, 15 minutes).
// No Next.js imports. Verified by tests/unit/family-hub-phase2.test.ts.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Db, Queryable } from '@/lib/db';
import { isUuid } from '@/lib/accounts/pin';
import { hash, newToken } from '@/lib/tokens';
import { memberRole } from './repo';
import { KID_VIEW_TTL_MS, isKidPin } from './rules';

export const KID_COOKIE = '__Host-sk_kidview';

const KEY_LEN = 32;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

const derive = (pin: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(pin, salt, KEY_LEN, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashKidPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await derive(pin, salt)).toString('hex')}`;
}

async function pinMatches(pin: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex ?? '', 'hex');
  if (!saltHex || expected.length !== KEY_LEN) return false;
  return timingSafeEqual(await derive(pin, Buffer.from(saltHex, 'hex')), expected);
}

type PinRow = { kid_view_pin_hash: string | null; kid_view_pin_failures: number; kid_view_pin_locked_until: string | null };

// Whether the profile exists in that circle, has a PIN (kid view on) and is currently locked.
// The entry page's only facts — the uuids in the URL are the address, the PIN is the key.
export async function kidViewStatus(db: Queryable, circleId: string, kidProfileId: string): Promise<{ exists: boolean; hasPin: boolean; locked: boolean }> {
  if (!isUuid(circleId) || !isUuid(kidProfileId)) return { exists: false, hasPin: false, locked: false };
  const r = await db.query<PinRow>('SELECT kid_view_pin_hash, kid_view_pin_failures, kid_view_pin_locked_until FROM hub_kid_profiles WHERE circle_id = $1 AND id = $2', [circleId, kidProfileId]);
  const row = r.rows[0];
  if (!row) return { exists: false, hasPin: false, locked: false };
  return { exists: true, hasPin: row.kid_view_pin_hash !== null, locked: row.kid_view_pin_locked_until !== null && new Date(row.kid_view_pin_locked_until) > new Date() };
}

export type PinCheck = 'ok' | 'wrong' | 'locked' | 'off';

// Checks the PIN under the profile row lock so concurrent guesses cannot skip the counter.
export async function verifyKidPin(db: Db, circleId: string, kidProfileId: string, pin: unknown, now: Date): Promise<PinCheck> {
  if (!isUuid(circleId) || !isUuid(kidProfileId)) return 'off';
  return db.transaction(async (tx) => {
    const r = await tx.query<PinRow>('SELECT kid_view_pin_hash, kid_view_pin_failures, kid_view_pin_locked_until FROM hub_kid_profiles WHERE circle_id = $1 AND id = $2 FOR UPDATE', [circleId, kidProfileId]);
    const row = r.rows[0];
    if (!row || !row.kid_view_pin_hash) return 'off' as const;
    if (row.kid_view_pin_locked_until && new Date(row.kid_view_pin_locked_until) > now) return 'locked' as const;
    if (isKidPin(pin) && (await pinMatches(pin, row.kid_view_pin_hash))) {
      await tx.query('UPDATE hub_kid_profiles SET kid_view_pin_failures = 0, kid_view_pin_locked_until = NULL WHERE id = $1', [kidProfileId]);
      return 'ok' as const;
    }
    const failures = row.kid_view_pin_failures + 1;
    if (failures >= MAX_FAILURES) {
      await tx.query('UPDATE hub_kid_profiles SET kid_view_pin_failures = 0, kid_view_pin_locked_until = $2 WHERE id = $1', [kidProfileId, new Date(now.getTime() + LOCK_MS).toISOString()]);
      return 'locked' as const;
    }
    await tx.query('UPDATE hub_kid_profiles SET kid_view_pin_failures = $2 WHERE id = $1', [kidProfileId, failures]);
    return 'wrong' as const;
  });
}

// Parent-side PIN management (member-checked here like every other Hub write). Setting or
// clearing the PIN revokes every outstanding kid-view session for the profile.
export async function setKidPin(db: Db, circleId: string, actorId: string, kidProfileId: string, pin: unknown): Promise<boolean> {
  if (!isUuid(kidProfileId) || !isKidPin(pin) || !(await memberRole(db, circleId, actorId))) return false;
  return db.transaction(async (tx) => {
    const r = await tx.query('UPDATE hub_kid_profiles SET kid_view_pin_hash = $3, kid_view_pin_failures = 0, kid_view_pin_locked_until = NULL, updated_at = now() WHERE circle_id = $1 AND id = $2', [circleId, kidProfileId, await hashKidPin(pin)]);
    if (r.rowCount !== 1) return false;
    await tx.query('DELETE FROM hub_kid_view_sessions WHERE kid_profile_id = $1', [kidProfileId]);
    return true;
  });
}

export async function clearKidPin(db: Db, circleId: string, actorId: string, kidProfileId: string): Promise<boolean> {
  if (!isUuid(kidProfileId) || !(await memberRole(db, circleId, actorId))) return false;
  return db.transaction(async (tx) => {
    const r = await tx.query('UPDATE hub_kid_profiles SET kid_view_pin_hash = NULL, kid_view_pin_failures = 0, kid_view_pin_locked_until = NULL, updated_at = now() WHERE circle_id = $1 AND id = $2', [circleId, kidProfileId]);
    if (r.rowCount !== 1) return false;
    await tx.query('DELETE FROM hub_kid_view_sessions WHERE kid_profile_id = $1', [kidProfileId]);
    return true;
  });
}

// Locks the kid view on every device without touching the PIN (sessions deleted).
export async function lockKidView(db: Db, circleId: string, actorId: string, kidProfileId: string): Promise<boolean> {
  if (!isUuid(kidProfileId) || !(await memberRole(db, circleId, actorId))) return false;
  const kid = await db.query('SELECT 1 FROM hub_kid_profiles WHERE circle_id = $1 AND id = $2', [circleId, kidProfileId]);
  if (kid.rows.length !== 1) return false;
  await db.query('DELETE FROM hub_kid_view_sessions WHERE circle_id = $1 AND kid_profile_id = $2', [circleId, kidProfileId]);
  return true;
}

// ---- Sessions ----

export async function createKidViewSession(db: Db, circleId: string, kidProfileId: string, now: Date): Promise<string> {
  const token = newToken();
  await db.query('INSERT INTO hub_kid_view_sessions (token_hash, circle_id, kid_profile_id, expires_at) VALUES ($1, $2, $3, $4)', [
    hash(token), circleId, kidProfileId, new Date(now.getTime() + KID_VIEW_TTL_MS).toISOString(),
  ]);
  return token;
}

export type KidViewContext = { circleId: string; kidProfileId: string };

// The one resolution path for kid routes: the token decides the (circle, kid); ids in a URL
// or form are only ever compared against it, never trusted instead of it.
export async function resolveKidView(db: Queryable, token: string | undefined, now: Date): Promise<KidViewContext | null> {
  if (!token || typeof token !== 'string' || token.length < 16) return null;
  const r = await db.query<{ circle_id: string; kid_profile_id: string; expires_at: string }>(
    'SELECT circle_id, kid_profile_id, expires_at FROM hub_kid_view_sessions WHERE token_hash = $1',
    [hash(token)],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at) <= now) {
    await db.query('DELETE FROM hub_kid_view_sessions WHERE token_hash = $1', [hash(token)]);
    return null;
  }
  return { circleId: row.circle_id, kidProfileId: row.kid_profile_id };
}

export async function revokeKidView(db: Db, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.query('DELETE FROM hub_kid_view_sessions WHERE token_hash = $1', [hash(token)]);
}

export const kidCookie = (token: string): string =>
  `${KID_COOKIE}=${token}; Path=/; Max-Age=${KID_VIEW_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Lax`;
export const kidCookieCleared = (): string => `${KID_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
