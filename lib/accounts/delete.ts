// Deletes an account and everything tied to it, in one transaction: the address's sign-in links (they have no foreign
// key), then the circles it owns are handed over or closed (lib/circles/owner.ts), then the row, which cascades sessions,
// consent tokens, child profiles, interests, saved answers, circle memberships, the circle invites it created and its
// referral row. Pending invites to its address are deleted first. No Next.js imports;
// tests/unit/account-consent.test.ts and tests/unit/circles-owner.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { handOverOwnedCircles } from '@/lib/circles/owner';

export async function deleteAccount(db: Db, accountId: string, now = new Date()): Promise<boolean> {
  return db.transaction((tx) => deleteAccountIn(tx, accountId, now));
}

// The same deletion inside a caller's transaction (withdraw validates its token and deletes under one account lock).
// `now` decides which circle members are adults when an owned circle is handed over.
export async function deleteAccountIn(tx: Queryable, accountId: string, now = new Date()): Promise<boolean> {
  const found = await tx.query<{ email: string }>('SELECT email FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
  const row = found.rows[0];
  if (!row) {
    return false;
  }
  await tx.query('DELETE FROM account_login_tokens WHERE email = $1', [row.email]);
  // Pending circle invites to the address (no foreign key); the account's own invites and referral row cascade.
  await tx.query('DELETE FROM circle_invites WHERE invited_email = $1', [row.email]);
  await handOverOwnedCircles(tx, accountId, now);
  await tx.query('DELETE FROM accounts WHERE id = $1', [accountId]);
  return true;
}
