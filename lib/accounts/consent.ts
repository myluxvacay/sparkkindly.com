// Parental consent for 13 to 15 accounts: tokens for the parent, confirm and withdraw. Tokens are random, stored only as
// sha256 hashes, bound to the account AND the parent address they were sent to. consentTarget validates without
// consuming (a mail scanner's GET changes nothing); confirm and withdraw are the only mutations. No Next.js imports.
// Verified by tests/unit/account-consent.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { hash, newToken } from '@/lib/tokens';
import { deleteAccountIn } from './delete';
import { maskEmail } from './wording';

const DAY = 24 * 60 * 60_000;
const CONFIRM_TTL = 30 * DAY;
const TOKEN = /^[0-9a-f]{64}$/;

export type ConsentPurpose = 'confirm' | 'withdraw';
export type ConsentTarget = {
  accountId: string;
  maskedParent: string;
  state: 'pending' | 'confirmed';
};

type Row = {
  account_id: string;
  parent_email: string;
  state: 'pending' | 'confirmed';
};

// Fresh confirm and withdraw tokens for a verified account whose consent is pending, or null. Replaces unused confirm
// tokens; a withdraw token issued earlier stays valid.
export async function issueConsentTokens(
  db: Db,
  accountId: string,
  now: Date,
): Promise<{ confirm: string; withdraw: string; parentEmail: string } | null> {
  return db.transaction(async (tx) => {
    const a = await tx.query<{ parent_email: string | null }>(
      `SELECT parent_email FROM accounts
       WHERE id = $1 AND verified_at IS NOT NULL AND consent_state = 'pending' AND parent_email IS NOT NULL FOR UPDATE`,
      [accountId],
    );
    const parentEmail = a.rows[0]?.parent_email;
    if (!parentEmail) {
      return null;
    }
    await tx.query(
      "DELETE FROM account_consent_tokens WHERE account_id = $1 AND purpose = 'confirm' AND used_at IS NULL",
      [accountId],
    );
    const confirm = newToken();
    const withdraw = newToken();
    const sql =
      'INSERT INTO account_consent_tokens (token_hash, account_id, parent_email, purpose, expires_at) VALUES ($1, $2, $3, $4, $5)';
    await tx.query(sql, [
      hash(confirm),
      accountId,
      parentEmail,
      'confirm',
      new Date(now.getTime() + CONFIRM_TTL).toISOString(),
    ]);
    await tx.query(sql, [hash(withdraw), accountId, parentEmail, 'withdraw', null]);
    return { confirm, withdraw, parentEmail };
  });
}

// The token's row when it is well formed, of this purpose, unused, unexpired and still bound to the account's parent.
async function find(
  db: Queryable,
  token: string,
  purpose: ConsentPurpose,
  now: Date,
  lock = false,
): Promise<Row | null> {
  if (typeof token !== 'string' || !TOKEN.test(token)) {
    return null;
  }
  const r = await db.query<Row>(
    `SELECT t.account_id, t.parent_email, a.consent_state AS state
     FROM account_consent_tokens t JOIN accounts a ON a.id = t.account_id
     WHERE t.token_hash = $1 AND t.purpose = $2 AND t.used_at IS NULL
       AND (t.expires_at IS NULL OR t.expires_at > $3::timestamptz)
       AND t.parent_email = a.parent_email AND a.consent_state IN ('pending', 'confirmed')${lock ? ' FOR UPDATE OF a' : ''}`,
    [hash(token), purpose, now.toISOString()],
  );
  return r.rows[0] ?? null;
}

export async function consentTarget(
  db: Queryable,
  token: string,
  purpose: ConsentPurpose,
  now: Date,
): Promise<ConsentTarget | null> {
  const row = await find(db, token, purpose, now);
  return row
    ? {
        accountId: row.account_id,
        maskedParent: maskEmail(row.parent_email),
        state: row.state,
      }
    : null;
}

// The account row is locked first, so of two racing confirms the second re-reads the token as used and is invalid.
export async function confirmConsent(db: Db, token: string, now: Date): Promise<'confirmed' | 'invalid'> {
  return db.transaction(async (tx) => {
    const row = await find(tx, token, 'confirm', now, true);
    if (!row || row.state !== 'pending') {
      return 'invalid';
    }
    // The lock was taken by the first read; a racing confirm waits there and reads the token as used, so re-check.
    const again = await find(tx, token, 'confirm', now);
    if (!again) {
      return 'invalid';
    }
    await tx.query("UPDATE accounts SET consent_state = 'confirmed', consent_at = $2 WHERE id = $1", [
      row.account_id,
      now.toISOString(),
    ]);
    await tx.query('UPDATE account_consent_tokens SET used_at = $2 WHERE token_hash = $1', [
      hash(token),
      now.toISOString(),
    ]);
    await tx.query(
      "DELETE FROM account_consent_tokens WHERE account_id = $1 AND purpose = 'confirm' AND used_at IS NULL",
      [row.account_id],
    );
    return 'confirmed';
  });
}

export async function withdrawConsent(db: Db, token: string, now: Date): Promise<'withdrawn' | 'invalid'> {
  // Token check and deletion share one transaction holding the account row lock, so a parent_email cleared by the
  // sweep (or changed) between the two cannot let a stale token delete the account.
  return db.transaction(async (tx) => {
    const row = await find(tx, token, 'withdraw', now, true);
    return row && (await deleteAccountIn(tx, row.account_id)) ? 'withdrawn' : 'invalid';
  });
}
