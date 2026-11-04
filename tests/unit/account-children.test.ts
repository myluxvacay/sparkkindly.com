// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { checkPin, setPin } from '@/lib/accounts/pin';
import { deleteAccount } from '@/lib/accounts/delete';
import { createChildProfile, listChildProfiles, deleteChildProfile } from '@/lib/accounts/children';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM accounts');
});

async function account(dateOfBirth: string, parentEmail?: string): Promise<string> {
  const r = await signUp(db, { email: `kid${n++}@example.test`, dateOfBirth, parentEmail }, T0);
  if (r.status !== 'created') {
    throw new Error('sign-up failed');
  }
  return r.accountId;
}
const adult = () => account('1990-05-05');
const ok = {
  displayName: 'Mia',
  ageBand: '6-9',
  guardianConfirmed: 'on',
  pin: '1234',
};
const count = async (sql: string, p: unknown[] = []) => (await db.query<{ n: number }>(sql, p)).rows[0].n;

describe('createChildProfile', () => {
  it('creates a profile, records guardian confirmation and the PIN on first use', async () => {
    const id = await adult();
    const r = await createChildProfile(db, id, ok, T0);
    expect(r.status).toBe('created');
    const list = await listChildProfiles(db, id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ displayName: 'Mia', ageBand: '6-9' });
    const a = (
      await db.query<{ guardian_confirmed_at: Date | null }>(
        'SELECT guardian_confirmed_at FROM accounts WHERE id = $1',
        [id],
      )
    ).rows[0];
    expect(a.guardian_confirmed_at).not.toBeNull();
    expect(await checkPin(db, id, '1234', T0)).toBe('ok');
  });

  it('a second profile needs no new PIN and keeps the first confirmation time', async () => {
    const id = await adult();
    await createChildProfile(db, id, ok, T0);
    const first = (await db.query('SELECT guardian_confirmed_at AS g FROM accounts WHERE id = $1', [id])).rows[0];
    const r = await createChildProfile(
      db,
      id,
      { displayName: 'Leo', ageBand: '10-12', guardianConfirmed: true },
      new Date(T0.getTime() + 1000),
    );
    expect(r.status).toBe('created');
    expect(await listChildProfiles(db, id)).toHaveLength(2);
    expect((await db.query('SELECT guardian_confirmed_at AS g FROM accounts WHERE id = $1', [id])).rows[0]).toEqual(
      first,
    );
  });

  it('16-17, 13-15 (pending and confirmed) and unknown accounts are not allowed', async () => {
    const teen = await account('2009-06-01');
    const young = await account('2011-12-01', 'parent@example.test');
    const confirmed = await account('2011-12-01', 'parent2@example.test');
    await db.query("UPDATE accounts SET consent_state = 'confirmed' WHERE id = $1", [confirmed]);
    for (const id of [teen, young, confirmed, '00000000-0000-0000-0000-000000000000']) {
      expect(await createChildProfile(db, id, ok, T0)).toEqual({
        status: 'not_allowed',
      });
    }
    expect(await count('SELECT count(*)::int AS n FROM child_profiles')).toBe(0);
  });

  it('requires the guardian checkbox: only on, true or boolean true', async () => {
    const id = await adult();
    for (const g of [undefined, '', 'off', 'false', 'yes', '1', 1, false, null, ['on']]) {
      expect(await createChildProfile(db, id, { ...ok, guardianConfirmed: g }, T0), String(g)).toEqual({
        status: 'invalid',
      });
    }
    expect((await createChildProfile(db, id, { ...ok, guardianConfirmed: 'true' }, T0)).status).toBe('created');
  });

  it('needs a PIN the first time, and a malformed PIN is invalid', async () => {
    const id = await adult();
    expect(await createChildProfile(db, id, { ...ok, pin: undefined }, T0)).toEqual({ status: 'pin_required' });
    expect(await createChildProfile(db, id, { ...ok, pin: '12' }, T0)).toEqual({
      status: 'invalid',
    });
    expect(await count('SELECT count(*)::int AS n FROM child_profiles')).toBe(0);
    expect(
      (await db.query('SELECT pin_hash, guardian_confirmed_at FROM accounts WHERE id = $1', [id])).rows[0],
    ).toEqual({
      pin_hash: null,
      guardian_confirmed_at: null,
    });
  });

  it('validates the display name', async () => {
    const id = await adult();
    const bad = [
      '',
      '   ',
      'x'.repeat(31),
      'a@b',
      '12345',
      ' 007 ',
      'Mi\u0000a',
      'Mi\na',
      'Mi\u007fa',
      42,
      null,
      undefined,
    ];
    for (const displayName of bad) {
      expect(await createChildProfile(db, id, { ...ok, displayName }, T0), String(displayName)).toEqual({
        status: 'invalid',
      });
    }
    const r = await createChildProfile(db, id, { ...ok, displayName: '  ' + 'x'.repeat(30) + '  ' }, T0);
    expect(r.status).toBe('created');
    expect((await listChildProfiles(db, id))[0].displayName).toBe('x'.repeat(30));
    expect((await createChildProfile(db, id, { ...ok, displayName: 'Room 9' }, T0)).status).toBe('created');
  });

  it('validates the age band', async () => {
    const id = await adult();
    for (const ageBand of ['13-15', '6', '', undefined, 6, '6-9 ']) {
      expect(await createChildProfile(db, id, { ...ok, ageBand }, T0), String(ageBand)).toEqual({ status: 'invalid' });
    }
    expect((await createChildProfile(db, id, { ...ok, ageBand: '10-12' }, T0)).status).toBe('created');
  });
});

describe('deleteChildProfile', () => {
  it("removes the owner's profile and refuses another account's, leaving the row", async () => {
    const a = await adult();
    const b = await adult();
    const r = await createChildProfile(db, a, ok, T0);
    if (r.status !== 'created') {
      throw new Error('create failed');
    }
    expect(await deleteChildProfile(db, b, r.profileId)).toBe(false);
    expect(await listChildProfiles(db, a)).toHaveLength(1);
    expect(await deleteChildProfile(db, a, 'not-a-uuid')).toBe(false);
    expect(await deleteChildProfile(db, a, r.profileId)).toBe(true);
    expect(await listChildProfiles(db, a)).toHaveLength(0);
    expect(await deleteChildProfile(db, a, r.profileId)).toBe(false);
  });

  it('clears a session that had the profile active', async () => {
    const a = await adult();
    const r = await createChildProfile(db, a, ok, T0);
    if (r.status !== 'created') {
      throw new Error('create failed');
    }
    await db.query(
      "INSERT INTO account_sessions (token_hash, account_id, expires_at, last_seen_at, active_profile_id) VALUES ('h', $1, now() + interval '1 day', now(), $2)",
      [a, r.profileId],
    );
    await deleteChildProfile(db, a, r.profileId);
    expect((await db.query('SELECT active_profile_id FROM account_sessions')).rows[0]).toEqual({
      active_profile_id: null,
    });
  });
});

describe('listChildProfiles', () => {
  it("returns only the account's own profiles", async () => {
    const a = await adult();
    const b = await adult();
    await createChildProfile(db, a, ok, T0);
    await createChildProfile(db, b, { ...ok, displayName: 'Zed' }, T0);
    expect((await listChildProfiles(db, a)).map((p) => p.displayName)).toEqual(['Mia']);
  });
});

describe('account deletion', () => {
  it('removes the profiles with the account', async () => {
    const a = await adult();
    await createChildProfile(db, a, ok, T0);
    expect(await deleteAccount(db, a)).toBe(true);
    expect(await count('SELECT count(*)::int AS n FROM child_profiles')).toBe(0);
  });
});

describe('name normalisation and malformed ids', () => {
  it('rejects invisible, direction, fullwidth @ and fullwidth-digit names; accepts 16 emoji', async () => {
    const id = await adult();
    const bad = ['Mi\u200Ba', 'Mia\u202E', 'a\uFF20b', '\uFF11\uFF12\uFF13\uFF14', '\u0661\u0662\u0663'];
    for (const displayName of bad) {
      expect(await createChildProfile(db, id, { ...ok, displayName }, T0), displayName).toEqual({ status: 'invalid' });
    }
    const emoji = '\u{1F600}'.repeat(16);
    expect((await createChildProfile(db, id, { ...ok, displayName: emoji }, T0)).status).toBe('created');
    expect((await createChildProfile(db, id, { ...ok, displayName: '\u{1F600}'.repeat(31) }, T0)).status).toBe(
      'invalid',
    );
  });

  it('stores the NFKC-normalised name', async () => {
    const id = await adult();
    await createChildProfile(db, id, { ...ok, displayName: '\uFF2D\uFF49\uFF41' }, T0);
    expect((await listChildProfiles(db, id))[0].displayName).toBe('Mia');
  });

  it('a non-UUID account or profile id gets the neutral result instead of throwing', async () => {
    expect(await createChildProfile(db, 'nope', ok, T0)).toEqual({ status: 'not_allowed' });
    expect(await deleteChildProfile(db, 'nope', '00000000-0000-0000-0000-000000000000')).toBe(false);
    expect(await listChildProfiles(db, 'nope')).toEqual([]);
    expect(await setPin(db, 'nope', '1234')).toBe('invalid');
    expect(await checkPin(db, 'nope', '1234', T0)).toBe('wrong');
  });
});

describe('session active profile', () => {
  const session = (account: string, profile: string | null) =>
    db.query(
      "INSERT INTO account_sessions (token_hash, account_id, expires_at, last_seen_at, active_profile_id) VALUES ($3, $1, now() + interval '1 day', now(), $2)",
      [account, profile, `h${n++}`],
    );

  it("a session cannot point at another account's profile", async () => {
    const a = await adult();
    const b = await adult();
    const r = await createChildProfile(db, a, ok, T0);
    if (r.status !== 'created') {
      throw new Error('create failed');
    }
    await expect(session(b, r.profileId)).rejects.toThrow();
    await session(a, r.profileId);
  });

  it('deleting the active profile nulls only active_profile_id', async () => {
    const a = await adult();
    const r = await createChildProfile(db, a, ok, T0);
    if (r.status !== 'created') {
      throw new Error('create failed');
    }
    await session(a, r.profileId);
    await deleteChildProfile(db, a, r.profileId);
    expect((await db.query('SELECT account_id, active_profile_id FROM account_sessions')).rows).toEqual([
      { account_id: a, active_profile_id: null },
    ]);
  });
});
