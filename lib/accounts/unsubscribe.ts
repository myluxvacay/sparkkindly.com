// One-click unsubscribe tokens for non-essential email: account id and kind, signed with HMAC-SHA256 under
// UNSUBSCRIBE_SECRET (server env file, never committed, never stored in the database). No expiry, but bound to its
// kind: a token for one kind cannot turn off another. Without a secret of at least 32 characters nothing is minted or
// read. No Next.js imports; tests/unit/account-unsubscribe.test.ts.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { isUuid } from './pin';

export type UnsubscribeKind = 'daily_set' | 'weekly_circle' | 'invites';

const COLUMNS: Record<UnsubscribeKind, string> = {
  daily_set: 'notify_daily_set',
  weekly_circle: 'notify_weekly_circle',
  invites: 'notify_invites',
};
const MIN_SECRET = 32;

const isKind = (v: unknown): v is UnsubscribeKind => typeof v === 'string' && Object.hasOwn(COLUMNS, v);

export const unsubscribeSecret = (env: EnvLike): string => env.UNSUBSCRIBE_SECRET ?? '';

const sign = (secret: string, accountId: string, kind: UnsubscribeKind): Buffer =>
  createHmac('sha256', secret).update(`unsubscribe:v1:${accountId}:${kind}`).digest();

// "<account id>.<kind>.<base64url signature>", or null without a usable secret or with a bad id or kind.
export function unsubscribeToken(secret: string, accountId: string, kind: UnsubscribeKind): string | null {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET || !isUuid(accountId) || !isKind(kind)) {
    return null;
  }
  return `${accountId}.${kind}.${sign(secret, accountId, kind).toString('base64url')}`;
}

export function readUnsubscribeToken(
  secret: string,
  token: string,
): { accountId: string; kind: UnsubscribeKind } | null {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET || typeof token !== 'string') {
    return null;
  }
  const [accountId, kind, sig, ...rest] = token.split('.');
  if (rest.length || !isUuid(accountId) || !isKind(kind) || !sig) {
    return null;
  }
  const given = Buffer.from(sig, 'base64url');
  const expected = sign(secret, accountId, kind);
  return given.length === expected.length && timingSafeEqual(given, expected) ? { accountId, kind } : null;
}

// Turns that one preference off. True when the account exists.
export async function applyUnsubscribe(db: Db, accountId: string, kind: UnsubscribeKind): Promise<boolean> {
  if (!isUuid(accountId) || !isKind(kind)) {
    return false;
  }
  const r = await db.query(`UPDATE accounts SET ${COLUMNS[kind]} = false WHERE id = $1`, [accountId]);
  return (r.rowCount ?? 0) > 0;
}
