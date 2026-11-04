// Deletes an account and everything tied to it, in one transaction: the address's sign-in links (they have no foreign
// key), then the row, which cascades sessions and consent tokens. No Next.js imports; tests/unit/account-consent.test.ts.
import type { Db, Queryable } from '@/lib/db';

export async function deleteAccount(db: Db, accountId: string): Promise<boolean> {
  return db.transaction((tx) => deleteAccountIn(tx, accountId));
}

// The same deletion inside a caller's transaction (withdraw validates its token and deletes under one account lock).
export async function deleteAccountIn(tx: Queryable, accountId: string): Promise<boolean> {
  const found = await tx.query<{ email: string }>('SELECT email FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
  const row = found.rows[0];
  if (!row) {
    return false;
  }
  await tx.query('DELETE FROM account_login_tokens WHERE email = $1', [row.email]);
  await tx.query('DELETE FROM accounts WHERE id = $1', [accountId]);
  return true;
}
