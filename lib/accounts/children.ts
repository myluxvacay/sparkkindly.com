// Child profiles: created by an 18+ account holder who confirms they are the child's parent or guardian and sets the
// adult PIN. Age group and consent are re-derived from the stored account row, never from the caller. Only a display
// name and an age band are held. Closing a profile when the child turns 13 is the same as deleting it (the teen may
// open their own account). No Next.js imports. Verified by tests/unit/account-children.test.ts.
import type { Db } from '@/lib/db';
import { ageGroupFor, can, type Consent } from './policy';
import { hashPin, isPin, isUuid } from './pin';

export type AgeBand = '6-9' | '10-12';
export type ChildProfile = {
  id: string;
  displayName: string;
  ageBand: AgeBand;
  createdAt: Date;
};
export type CreateInput = {
  displayName: unknown;
  ageBand: unknown;
  guardianConfirmed: unknown;
  pin?: unknown;
};
export type CreateResult =
  { status: 'created'; profileId: string } | { status: 'invalid' | 'not_allowed' | 'pin_required' };

const NAME_MAX = 30;

const guardianChecked = (v: unknown): boolean => v === true || v === 'on' || v === 'true';

function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') {
    return null;
  }
  const name = v.normalize('NFKC').trim();
  if (
    [...name].length < 1 ||
    [...name].length > NAME_MAX ||
    name.includes('@') ||
    /^\p{Nd}+$/u.test(name) ||
    /[\p{Cc}\p{Cf}]/u.test(name)
  ) {
    return null;
  }
  return name;
}

const cleanBand = (v: unknown): AgeBand | null => (v === '6-9' || v === '10-12' ? v : null);

export async function createChildProfile(
  db: Db,
  accountId: string,
  input: CreateInput,
  now: Date,
): Promise<CreateResult> {
  if (!isUuid(accountId)) {
    return { status: 'not_allowed' };
  }
  return db.transaction(async (tx) => {
    const found = await tx.query<{
      date_of_birth: Date | string;
      consent_state: Consent;
      guardian_confirmed_at: Date | null;
      pin_hash: string | null;
    }>(
      `SELECT to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth, consent_state, guardian_confirmed_at, pin_hash
       FROM accounts WHERE id = $1 FOR UPDATE`,
      [accountId],
    );
    const a = found.rows[0];
    const group = a ? ageGroupFor(String(a.date_of_birth), now) : null;
    if (!a || group !== 'adult' || !can(group, a.consent_state, 'create_child_profile')) {
      return { status: 'not_allowed' };
    }
    const name = cleanName(input.displayName);
    const band = cleanBand(input.ageBand);
    if (!name || !band || !guardianChecked(input.guardianConfirmed)) {
      return { status: 'invalid' };
    }
    if (!a.pin_hash) {
      if (input.pin === undefined || input.pin === null || input.pin === '') {
        return { status: 'pin_required' };
      }
      if (!isPin(input.pin)) {
        return { status: 'invalid' };
      }
      await tx.query('UPDATE accounts SET pin_hash = $2, pin_failures = 0, pin_locked_until = NULL WHERE id = $1', [
        accountId,
        await hashPin(input.pin),
      ]);
    }
    if (!a.guardian_confirmed_at) {
      await tx.query('UPDATE accounts SET guardian_confirmed_at = $2 WHERE id = $1', [accountId, now.toISOString()]);
    }
    const r = await tx.query<{ id: string }>(
      'INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, $2, $3) RETURNING id',
      [accountId, name, band],
    );
    return { status: 'created', profileId: r.rows[0].id };
  });
}

export async function listChildProfiles(db: Db, accountId: string): Promise<ChildProfile[]> {
  if (!isUuid(accountId)) {
    return [];
  }
  const r = await db.query<{
    id: string;
    display_name: string;
    age_band: AgeBand;
    created_at: Date;
  }>(
    'SELECT id, display_name, age_band, created_at FROM child_profiles WHERE account_id = $1 ORDER BY created_at, id',
    [accountId],
  );
  return r.rows.map((p) => ({
    id: p.id,
    displayName: p.display_name,
    ageBand: p.age_band,
    createdAt: p.created_at,
  }));
}

// False when the profile is not this account's (or does not exist). Ruling (3C Task 3 review): a session still on the
// profile is ended in the same transaction, so that device falls back to anonymous (fail closed), never to the adult
// context; the composite FK's SET NULL stays only as defence in depth. Also how a profile is closed when the child
// turns 13: the teen may open their own account.
export async function deleteChildProfile(db: Db, accountId: string, profileId: string): Promise<boolean> {
  if (!isUuid(profileId) || !isUuid(accountId)) {
    return false;
  }
  return db.transaction(async (tx) => {
    await tx.query('DELETE FROM account_sessions WHERE active_profile_id = $1 AND account_id = $2', [profileId, accountId]);
    const r = await tx.query('DELETE FROM child_profiles WHERE id = $1 AND account_id = $2', [profileId, accountId]);
    return (r.rowCount ?? 0) > 0;
  });
}
