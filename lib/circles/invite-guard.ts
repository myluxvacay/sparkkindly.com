// Invite email guards (4B security review): a site-wide cap per invited address and a suppression list, both keyed by
// an HMAC-SHA256 of the canonical address (canonicalAddress) under UNSUBSCRIBE_SECRET with its own label, so no address is stored. Without
// a secret of at least 32 characters nothing is hashed and no invite email is sent. The stop token ("never email me
// invites again") is the address hash plus its own HMAC; it needs no account. No Next.js imports.
// Verified by tests/unit/circles-invite-guard.test.ts.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { domainToASCII } from 'node:url';
import type { Db, Queryable } from '@/lib/db';

export const ADDRESS_LIMITS = { perWeek: 3, days: 7, keepDays: 8 } as const;
const MIN_SECRET = 32;
const DAY = 86_400_000;
const HASH = /^[0-9a-f]{64}$/;

const usable = (secret: string) => typeof secret === 'string' && secret.length >= MIN_SECRET;
const mac = (secret: string, text: string) => createHmac('sha256', secret).update(text);

// Providers known to deliver 'local+tag' to 'local': only there is the tag dropped, so distinct mailboxes elsewhere
// never merge.
const PLUS_TAG_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'proton.me',
  'protonmail.com', 'fastmail.com',
]);

// One spelling per mailbox, so the spellings of one mailbox share one cap and suppression: lower-cased and trimmed, the
// domain in its ASCII (punycode) form; '+tag' dropped for PLUS_TAG_DOMAINS; for Gmail dots dropped and googlemail.com
// read as gmail.com. Any other local part is kept exactly.
export function canonicalAddress(email: string): string {
  const s = email.trim().toLowerCase();
  const at = s.lastIndexOf('@');
  if (at < 0) return s;
  let local = s.slice(0, at);
  let domain = domainToASCII(s.slice(at + 1)) || s.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (PLUS_TAG_DOMAINS.has(domain)) local = local.split('+')[0];
  if (domain === 'gmail.com') local = local.replaceAll('.', '');
  return `${local}@${domain}`;
}

export function addressHash(secret: string, email: string): string | null {
  return usable(secret) ? mac(secret, `invite-address:${canonicalAddress(email)}`).digest('hex') : null;
}

const stopSig = (secret: string, h: string) => mac(secret, `invite-suppress:v1:${h}`).digest('base64url');

export function suppressToken(secret: string, h: string): string | null {
  return usable(secret) && HASH.test(h) ? `${h}.${stopSig(secret, h)}` : null;
}

// The address hash a valid stop token names, or null. One canonical spelling of the signature is accepted.
export function readSuppressToken(secret: string, token: string): string | null {
  if (!usable(secret) || typeof token !== 'string') return null;
  const [h, sig, ...rest] = token.split('.');
  if (rest.length || !HASH.test(h ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(sig ?? '')) return null;
  const given = Buffer.from(sig);
  const expected = Buffer.from(stopSig(secret, h));
  return given.length === expected.length && timingSafeEqual(given, expected) ? h : null;
}

const LIMIT_SQL = `SELECT EXISTS (SELECT 1 FROM invite_suppressions WHERE addr_hash = $1) AS blocked,
  (SELECT count(*)::int FROM invite_address_log WHERE addr_hash = $1 AND sent_at > $2::timestamptz) AS recent`;

async function underLimit(q: Queryable, h: string, now: Date): Promise<boolean> {
  const r = await q.query<{ blocked: boolean; recent: number }>(LIMIT_SQL, [
    h,
    new Date(now.getTime() - ADDRESS_LIMITS.days * DAY).toISOString(),
  ]);
  return !r.rows[0].blocked && r.rows[0].recent < ADDRESS_LIMITS.perWeek;
}

// Read-only: true when the address is neither suppressed nor at its weekly cap (checked before spending a budget slot).
export const addressSendable = (q: Queryable, h: string, now: Date): Promise<boolean> => underLimit(q, h, now);

// True (and logged) when an invite email may go to this address now: not suppressed and under the weekly cap. An
// advisory lock on the hash makes concurrent sends to one address count one after another.
export async function claimAddressSend(db: Db, h: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invite-address:${h}`]);
    if (!(await underLimit(tx, h, now))) return false;
    await tx.query('INSERT INTO invite_address_log (addr_hash, sent_at) VALUES ($1, $2)', [h, now.toISOString()]);
    return true;
  });
}

// Gives back a slot claimAddressSend took when the send itself failed.
export async function releaseAddressSend(db: Queryable, h: string, now: Date): Promise<void> {
  await db.query(
    `DELETE FROM invite_address_log WHERE ctid = (
       SELECT ctid FROM invite_address_log WHERE addr_hash = $1 AND sent_at = $2::timestamptz LIMIT 1)`,
    [h, now.toISOString()],
  );
}

export async function suppressAddress(db: Queryable, h: string): Promise<void> {
  await db.query('INSERT INTO invite_suppressions (addr_hash) VALUES ($1) ON CONFLICT DO NOTHING', [h]);
}

// Log rows older than 8 days count for nothing; the invites purge removes them.
export async function pruneAddressLog(db: Queryable, now: Date): Promise<number> {
  const r = await db.query('DELETE FROM invite_address_log WHERE sent_at < $1::timestamptz', [
    new Date(now.getTime() - ADDRESS_LIMITS.keepDays * DAY).toISOString(),
  ]);
  return r.rowCount ?? 0;
}
