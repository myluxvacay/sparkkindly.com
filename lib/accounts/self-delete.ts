// Self-service account deletion: the holder types the account email (case-insensitive, trimmed) and the account goes
// through deleteAccount (sign-in links by email, then the row, which cascades everything else). Logs nothing.
// The account id comes from the server-side context. No Next.js imports; tests/unit/account-self-delete.test.ts.
import type { Db } from '@/lib/db';
import { deleteAccount } from './delete';
import { isUuid } from './pin';

export async function deleteOwnAccount(
  db: Db,
  accountId: string,
  typedEmail: unknown,
): Promise<'deleted' | 'mismatch' | 'not_found'> {
  if (!isUuid(accountId)) {
    return 'not_found';
  }
  const r = await db.query<{ email: string }>('SELECT email FROM accounts WHERE id = $1', [accountId]);
  const stored = r.rows[0]?.email;
  if (!stored) {
    return 'not_found';
  }
  // Stored addresses are already trimmed and lower-cased (CHECK in 007_accounts.sql); an account email never changes.
  if (typeof typedEmail !== 'string' || typedEmail.trim().toLowerCase() !== stored) {
    return 'mismatch';
  }
  return (await deleteAccount(db, accountId)) ? 'deleted' : 'not_found';
}
