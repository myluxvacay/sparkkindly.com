// Child profiles in circles (plan 4A, spec Project 4 and 4a.5): an adult adds their own child profile to a family circle
// they currently belong to, after confirming that everyone in the circle sees the child's display name and scores. A
// circle holding a child admits adult accounts only: a child is never added beside a 13-17 member, and the 4B join path
// refuses teens with circleHasChild. Circle row first, then the adult's account row (the circle lock serialises joins).
// No Next.js imports. Verified by tests/unit/circles-children.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { isUuid } from '@/lib/accounts/pin';
import { ageGroupFor } from '@/lib/accounts/policy';
import { LIMITS } from './rules';
import { isSlug, lockCircle, memberCount, myRole } from './repo';

export type AddChildResult = 'added' | 'invalid' | 'not_allowed' | 'not_family' | 'has_teen' | 'limit' | 'already';

const confirmedBox = (v: unknown): boolean => v === true || v === 'on' || v === 'true';

export async function circleHasChild(db: Queryable, circleId: string): Promise<boolean> {
  const r = await db.query(
    'SELECT 1 FROM circle_members WHERE circle_id = $1 AND profile_id IS NOT NULL AND left_at IS NULL LIMIT 1',
    [circleId],
  );
  return r.rows.length > 0;
}

// True when any current account member is 13 to 17 at `now`.
async function hasTeen(tx: Queryable, circleId: string, now: Date): Promise<boolean> {
  const r = await tx.query<{ dob: string }>(
    `SELECT to_char(a.date_of_birth, 'YYYY-MM-DD') AS dob FROM circle_members m JOIN accounts a ON a.id = m.account_id
     WHERE m.circle_id = $1 AND m.profile_id IS NULL AND m.left_at IS NULL`,
    [circleId],
  );
  return r.rows.some((m) => ageGroupFor(m.dob, now) !== 'adult');
}

// The profile's display name when it belongs to the account and the account is 18 or over; else null.
async function ownChild(tx: Queryable, accountId: string, profileId: string, now: Date): Promise<string | null> {
  const r = await tx.query<{ dob: string; display_name: string }>(
    `SELECT to_char(a.date_of_birth, 'YYYY-MM-DD') AS dob, p.display_name
     FROM accounts a JOIN child_profiles p ON p.account_id = a.id WHERE a.id = $1 AND p.id = $2 FOR SHARE OF a`,
    [accountId, profileId],
  );
  const row = r.rows[0];
  return row && ageGroupFor(row.dob, now) === 'adult' ? row.display_name : null;
}

export async function addChildToCircle(
  db: Db,
  accountId: string,
  slug: string,
  profileId: string,
  confirmed: unknown,
  now: Date,
): Promise<AddChildResult> {
  if (!isUuid(accountId) || !isUuid(profileId) || !confirmedBox(confirmed)) {
    return 'invalid';
  }
  return db.transaction(async (tx) => {
    const c = await lockCircle(tx, slug);
    if (!c || c.status !== 'open' || c.hidden_at || !(await myRole(tx, c.id, accountId))) {
      return 'not_allowed';
    }
    const name = await ownChild(tx, accountId, profileId, now);
    if (!name) {
      return 'not_allowed';
    }
    if (c.kind !== 'family') {
      return 'not_family';
    }
    const current = await tx.query(
      'SELECT 1 FROM circle_members WHERE circle_id = $1 AND profile_id = $2 AND left_at IS NULL',
      [c.id, profileId],
    );
    if (current.rows.length > 0) {
      return 'already';
    }
    if (await hasTeen(tx, c.id, now)) {
      return 'has_teen';
    }
    if ((await memberCount(tx, c.id)) >= LIMITS.members) {
      return 'limit';
    }
    // A child removed earlier comes back on its old row (one row per circle and profile).
    await tx.query(
      `INSERT INTO circle_members (circle_id, account_id, profile_id, display_name, joined_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (circle_id, account_id, COALESCE(profile_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET left_at = NULL, joined_at = EXCLUDED.joined_at, display_name = EXCLUDED.display_name`,
      [c.id, accountId, profileId, name, now.toISOString()],
    );
    return 'added';
  });
}

// False when the profile is not this account's, not in the circle, or the circle is closed.
export async function removeChildFromCircle(
  db: Db,
  accountId: string,
  slug: string,
  profileId: string,
  now: Date,
): Promise<boolean> {
  if (!isUuid(accountId) || !isUuid(profileId) || !isSlug(slug)) {
    return false;
  }
  return db.transaction(async (tx) => {
    const c = await lockCircle(tx, slug);
    if (!c || c.status !== 'open') {
      return false;
    }
    const r = await tx.query(
      'UPDATE circle_members SET left_at = $4 WHERE circle_id = $1 AND account_id = $2 AND profile_id = $3 AND left_at IS NULL',
      [c.id, accountId, profileId, now.toISOString()],
    );
    return (r.rowCount ?? 0) > 0;
  });
}
