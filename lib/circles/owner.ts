// Circle owner actions (plan 4A, spec Project 4 "Circle rules"): remove a member, transfer ownership to another adult
// account member, close the circle; and the hand-over when the owner's account is deleted. The owner id is the session's
// account. Every action first locks the circle row (FOR UPDATE), so racing actions on one circle run one after another
// and an open circle always has exactly one owner. A closed circle accepts no owner action.
// No Next.js imports. Verified by tests/unit/circles-owner.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { isUuid, uuidOf } from '@/lib/accounts/pin';
import { ageGroupFor } from '@/lib/accounts/policy';
import { lockCircle, myRole, type CircleRow } from './repo';

export type MemberKey = { accountId: string; profileId: string | null };

// The circle locked for an owner action by `ownerId`, or the refusal.
async function asOwner(tx: Queryable, ownerId: string, slug: string): Promise<CircleRow | 'not_owner' | 'closed'> {
  const c = isUuid(ownerId) ? await lockCircle(tx, slug) : null;
  if (!c || c.owner_account_id !== ownerId || (await myRole(tx, c.id, ownerId)) !== 'owner') {
    return 'not_owner';
  }
  return c.status === 'closed' ? 'closed' : c;
}

type RemoveResult = 'removed' | 'not_owner' | 'not_found' | 'is_owner' | 'closed';

export async function removeMember(db: Db, ownerId: string, slug: string, member: MemberKey, now: Date): Promise<RemoveResult> {
  return db.transaction(async (tx) => {
    const c = await asOwner(tx, ownerId, slug);
    return typeof c === 'string' ? c : removeLocked(tx, c, ownerId, member, now);
  });
}

// The member behind an owner form's opaque key, within this circle only (another circle's key, or a raw id, is null).
async function memberByKey(tx: Queryable, circleId: string, key: unknown): Promise<MemberKey | null> {
  if (typeof key !== 'string' || !/^[0-9a-f]{16}$/.test(key)) return null;
  const r = await tx.query<{ account_id: string; profile_id: string | null }>(
    'SELECT account_id, profile_id FROM circle_members WHERE circle_id = $1 AND member_key = $2 AND left_at IS NULL',
    [circleId, key],
  );
  const m = r.rows[0];
  return m ? { accountId: m.account_id, profileId: m.profile_id } : null;
}

// removeMember for an owner form: the member named by its key in the owner's own circle.
export async function removeMemberByKey(db: Db, ownerId: string, slug: string, key: unknown, now: Date): Promise<RemoveResult> {
  return db.transaction(async (tx) => {
    const c = await asOwner(tx, ownerId, slug);
    if (typeof c === 'string') return c;
    const member = await memberByKey(tx, c.id, key);
    return member ? removeLocked(tx, c, ownerId, member, now) : 'not_found';
  });
}

async function removeLocked(tx: Queryable, c: CircleRow, ownerId: string, member: MemberKey, now: Date): Promise<RemoveResult> {
  const accountId = uuidOf(member?.accountId);
  const profileId = member?.profileId === null ? null : uuidOf(member?.profileId);
  if (!accountId || (member.profileId !== null && !profileId)) {
    return 'not_found';
  }
  if (accountId === ownerId.toLowerCase() && profileId === null) {
    return 'is_owner';
  }
  // An account member leaves with its child profiles; a child profile alone leaves its adult in place.
  // removed_at (unlike a plain leave) keeps a removed account from joining again (lib/circles/join.ts).
  // role = 'member': the owner row is never removed, whatever spelling of an id reaches here.
  const r = await tx.query(
    `UPDATE circle_members SET left_at = $4, removed_at = $4
     WHERE circle_id = $1 AND account_id = $2 AND left_at IS NULL AND role = 'member'
       AND ($3::uuid IS NULL OR profile_id = $3::uuid)
       AND EXISTS (SELECT 1 FROM circle_members t WHERE t.circle_id = $1 AND t.account_id = $2 AND t.left_at IS NULL
                   AND t.profile_id IS NOT DISTINCT FROM $3::uuid)`,
    [c.id, accountId, profileId, now.toISOString()],
  );
  if ((r.rowCount ?? 0) === 0) return 'not_found';
  if (profileId === null) {
    // A removed account's own invites to this circle stop working with it.
    await tx.query('UPDATE circle_invites SET revoked_at = $3 WHERE circle_id = $1 AND created_by = $2 AND revoked_at IS NULL', [
      c.id,
      accountId,
      now.toISOString(),
    ]);
  }
  return 'removed';
}

// True when `accountId` is a current account member of the circle and 18 or over at `now`.
async function adultMember(tx: Queryable, circleId: string, accountId: string, now: Date): Promise<boolean> {
  const r = await tx.query<{ dob: string }>(
    `SELECT to_char(a.date_of_birth, 'YYYY-MM-DD') AS dob FROM circle_members m JOIN accounts a ON a.id = m.account_id
     WHERE m.circle_id = $1 AND m.account_id = $2 AND m.profile_id IS NULL AND m.left_at IS NULL FOR SHARE OF a`,
    [circleId, accountId],
  );
  return r.rows[0] !== undefined && ageGroupFor(r.rows[0].dob, now) === 'adult';
}

// Moves the owner role from the current owner row to `to` (both are current account members).
async function setOwner(tx: Queryable, circleId: string, to: string): Promise<void> {
  await tx.query('UPDATE circles SET owner_account_id = $2 WHERE id = $1', [circleId, to]);
  await tx.query(
    `UPDATE circle_members SET role = CASE WHEN account_id = $2 THEN 'owner' ELSE 'member' END
     WHERE circle_id = $1 AND profile_id IS NULL AND (role = 'owner' OR account_id = $2)`,
    [circleId, to],
  );
}

type TransferResult = 'transferred' | 'not_owner' | 'not_eligible' | 'closed';

export async function transferOwnership(
  db: Db,
  ownerId: string,
  slug: string,
  toAccountId: string,
  now: Date,
): Promise<TransferResult> {
  return db.transaction(async (tx) => {
    const c = await asOwner(tx, ownerId, slug);
    if (typeof c === 'string') {
      return c;
    }
    return transferLocked(tx, c, ownerId, toAccountId, now);
  });
}

async function transferLocked(tx: Queryable, c: CircleRow, ownerId: string, to: unknown, now: Date): Promise<TransferResult> {
  const toAccountId = uuidOf(to);
  if (!toAccountId || toAccountId === ownerId.toLowerCase() || !(await adultMember(tx, c.id, toAccountId, now))) {
    return 'not_eligible';
  }
  await setOwner(tx, c.id, toAccountId);
  return 'transferred';
}

// transferOwnership for an owner form: the new owner named by its key (an account row, not a child) in this circle.
export async function transferOwnershipByKey(db: Db, ownerId: string, slug: string, key: unknown, now: Date): Promise<TransferResult> {
  return db.transaction(async (tx) => {
    const c = await asOwner(tx, ownerId, slug);
    if (typeof c === 'string') return c;
    const m = await memberByKey(tx, c.id, key);
    return m && m.profileId === null ? transferLocked(tx, c, ownerId, m.accountId, now) : 'not_eligible';
  });
}

// Closing again is a no-op that answers 'closed'. A closed circle is read-only and is purged 30 days after closed_at.
export async function closeCircle(db: Db, ownerId: string, slug: string, now: Date): Promise<'closed' | 'not_owner'> {
  return db.transaction(async (tx) => {
    const c = await asOwner(tx, ownerId, slug);
    if (typeof c === 'string') {
      return c;
    }
    await tx.query("UPDATE circles SET status = 'closed', closed_at = $2 WHERE id = $1", [c.id, now.toISOString()]);
    return 'closed';
  });
}

// Inside the account deletion's transaction, before the account row goes: each open circle the account owns passes to
// its longest-standing other adult account member, or, with none, is closed. Every owned circle then drops the owner
// reference (closed circles only), so nothing points at the deleted account. Circles are locked in id order.
export async function handOverOwnedCircles(tx: Queryable, accountId: string, now: Date): Promise<void> {
  const owned = await tx.query<{ id: string; status: string }>(
    'SELECT id, status FROM circles WHERE owner_account_id = $1 ORDER BY id FOR UPDATE',
    [accountId],
  );
  for (const c of owned.rows) {
    const heir = c.status === 'open' ? await longestStandingAdult(tx, c.id, accountId, now) : null;
    if (heir) {
      await setOwner(tx, c.id, heir);
      continue;
    }
    await tx.query(
      `UPDATE circles SET owner_account_id = NULL, status = 'closed', closed_at = COALESCE(closed_at, $2) WHERE id = $1`,
      [c.id, now.toISOString()],
    );
  }
}

async function longestStandingAdult(tx: Queryable, circleId: string, except: string, now: Date): Promise<string | null> {
  const r = await tx.query<{ account_id: string; dob: string }>(
    `SELECT m.account_id, to_char(a.date_of_birth, 'YYYY-MM-DD') AS dob
     FROM circle_members m JOIN accounts a ON a.id = m.account_id
     WHERE m.circle_id = $1 AND m.account_id <> $2 AND m.profile_id IS NULL AND m.left_at IS NULL
     ORDER BY m.joined_at, m.account_id FOR SHARE OF a`,
    [circleId, except],
  );
  return r.rows.find((m) => ageGroupFor(m.dob, now) === 'adult')?.account_id ?? null;
}
