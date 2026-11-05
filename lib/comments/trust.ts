// Comment trust (plan 7A, spec Project 7 "Trust levels"): level 0 comments are held, level 1 publish after the checks.
// TRUST_THRESHOLD approvals since the last drop reach level 1; a rejection drops a level and resets the approved count;
// the owner sets a level or bans in /admin. recordApproval and recordRejection are called by the moderation side (7B)
// inside its transaction. No Next.js imports. Verified by tests/unit/comments-trust.test.ts.
import type { Queryable } from '@/lib/db';
import { isUuid } from '@/lib/accounts/pin';
import { TRUST_THRESHOLD } from './rules';

export type Trust = {
  level: 0 | 1;
  approved: number;
  rejected: number;
  banned: boolean;
  displayName: string | null;
  guidelinesAcceptedAt: Date | null;
};

type TrustRow = {
  level: 0 | 1;
  approved: number;
  rejected: number;
  banned: boolean;
  display_name: string | null;
  guidelines_accepted_at: Date | null;
};

const COLUMNS = 'level, approved, rejected, banned, display_name, guidelines_accepted_at';
const DEFAULT: Trust = { level: 0, approved: 0, rejected: 0, banned: false, displayName: null, guidelinesAcceptedAt: null };

const toTrust = (r: TrustRow | undefined): Trust =>
  r
    ? {
        level: r.level,
        approved: r.approved,
        rejected: r.rejected,
        banned: r.banned,
        displayName: r.display_name,
        guidelinesAcceptedAt: r.guidelines_accepted_at,
      }
    : { ...DEFAULT };

export async function getTrust(db: Queryable, accountId: string): Promise<Trust> {
  if (!isUuid(accountId)) {
    return { ...DEFAULT };
  }
  const r = await db.query<TrustRow>(`SELECT ${COLUMNS} FROM account_trust WHERE account_id = $1`, [accountId]);
  return toTrust(r.rows[0]);
}

// Creates the row if missing and locks it for the rest of the caller's transaction: every comment write by one account
// runs under this lock, so its rate and duplicate counts cannot race. The caller has verified the account exists.
export async function lockTrust(tx: Queryable, accountId: string): Promise<Trust> {
  await tx.query('INSERT INTO account_trust (account_id) VALUES ($1) ON CONFLICT DO NOTHING', [accountId]);
  const r = await tx.query<TrustRow>(`SELECT ${COLUMNS} FROM account_trust WHERE account_id = $1 FOR UPDATE`, [accountId]);
  return toTrust(r.rows[0]);
}

// Creates the row for an existing account if missing, then applies `set` to it; false for an unknown or malformed id.
async function update(tx: Queryable, accountId: string, set: string, params: unknown[] = []): Promise<boolean> {
  if (!isUuid(accountId)) {
    return false;
  }
  await tx.query('INSERT INTO account_trust (account_id) SELECT id FROM accounts WHERE id = $1 ON CONFLICT DO NOTHING', [
    accountId,
  ]);
  const r = await tx.query(`UPDATE account_trust SET ${set}, updated_at = now() WHERE account_id = $1`, [accountId, ...params]);
  return r.rowCount === 1;
}

export const recordApproval = (tx: Queryable, accountId: string): Promise<boolean> =>
  update(tx, accountId, 'approved = approved + 1, level = CASE WHEN approved + 1 >= $2 THEN 1 ELSE level END', [
    TRUST_THRESHOLD,
  ]);

export const recordRejection = (tx: Queryable, accountId: string): Promise<boolean> =>
  update(tx, accountId, 'rejected = rejected + 1, approved = 0, level = greatest(level - 1, 0)');

export async function setTrust(tx: Queryable, accountId: string, o: { level?: 0 | 1; banned?: boolean }): Promise<boolean> {
  if ((o.level !== undefined && o.level !== 0 && o.level !== 1) || (o.banned !== undefined && typeof o.banned !== 'boolean')) {
    return false;
  }
  return update(tx, accountId, 'level = COALESCE($2::int, level), banned = COALESCE($3::boolean, banned)', [
    o.level ?? null,
    o.banned ?? null,
  ]);
}
