// @vitest-environment node
// The server-derived active context (plan 3C Task 2): account, active child profile, allowed audiences, PIN-guarded
// switching. Everything comes from the session token; the only id a caller passes is the profile to switch to.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { requestAccountLink, consumeAccountLink, getAccount } from '@/lib/accounts/sessions';
import { createChildProfile, deleteChildProfile } from '@/lib/accounts/children';
import { changePin, checkPin } from '@/lib/accounts/pin';
import { childCan, type Capability } from '@/lib/accounts/policy';
import { getContext, switchToProfile, switchToAdult, requireAdultContext } from '@/lib/accounts/context';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const MIN = 60_000;
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const env = {};
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

// A fresh adult account with one child profile (PIN 1234) and a signed-in session.
async function family(dateOfBirth = '1990-05-05') {
  const email = `ctx${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth }, T0);
  if (r.status !== 'created') {
    throw new Error('sign-up failed');
  }
  const p = await createChildProfile(db, r.accountId, { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: 'on', pin: '1234' }, T0);
  if (p.status !== 'created') {
    throw new Error('profile not created');
  }
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, env, T0))!, T0))!;
  return { accountId: r.accountId, profileId: p.profileId, session };
}
const activeProfiles = async (accountId: string) =>
  (await db.query<{ id: string | null }>('SELECT active_profile_id AS id FROM account_sessions WHERE account_id = $1', [accountId])).rows.map(
    (r) => r.id,
  );

describe('getContext', () => {
  it('an adult context has no profile and every audience', async () => {
    const f = await family();
    const ctx = await getContext(db, f.session, T0);
    expect(ctx?.account.id).toBe(f.accountId);
    expect(ctx?.profile).toBeNull();
    expect([...ctx!.audiences].sort()).toEqual(['adults', 'all', 'kids']);
  });

  it('a 13-15 account context is the account (no profile); missing or bad tokens are null', async () => {
    const r = await signUp(db, { email: 'ctxteen@example.test', dateOfBirth: '2011-12-01', parentEmail: 'p@example.test' }, T0);
    expect(r.status).toBe('created');
    const s = (await consumeAccountLink(db, (await requestAccountLink(db, 'ctxteen@example.test', env, T0))!, T0))!;
    expect((await getContext(db, s, T0))?.profile).toBeNull();
    for (const bad of ['', 'nope', undefined as unknown as string, "' OR 1=1 --"]) {
      expect(await getContext(db, bad, T0)).toBeNull();
    }
  });
});

describe('switchToProfile', () => {
  it('sets the active profile; the child context is kids and all only, never adults', async () => {
    const f = await family();
    expect(await switchToProfile(db, f.session, f.profileId, T0)).toBe(true);
    const ctx = await getContext(db, f.session, T0);
    expect(ctx?.account.id).toBe(f.accountId);
    expect(ctx?.profile).toEqual({ id: f.profileId, displayName: 'Mia', ageBand: '6-9' });
    expect([...ctx!.audiences].sort()).toEqual(['all', 'kids']);
    expect(ctx!.audiences).not.toContain('adults');
  });

  it("another account's profile id returns false and changes nothing, even though the id is valid", async () => {
    const a = await family();
    const b = await family();
    expect(await switchToProfile(db, a.session, b.profileId, T0)).toBe(false);
    expect((await getContext(db, a.session, T0))?.profile).toBeNull();
    expect(await activeProfiles(a.accountId)).toEqual([null]);
    expect((await getContext(db, b.session, T0))?.profile).toBeNull();
  });

  it('malformed, unknown and non-string profile ids, and bad sessions, return false', async () => {
    const f = await family();
    for (const bad of ['', 'x', '00000000-0000-0000-0000-000000000000', `${f.profileId}x`, null, 42, [f.profileId]]) {
      expect(await switchToProfile(db, f.session, bad as string, T0), String(bad)).toBe(false);
    }
    expect(await switchToProfile(db, 'nope', f.profileId, T0)).toBe(false);
    expect((await getContext(db, f.session, T0))?.profile).toBeNull();
  });

  it('a child context cannot switch to another profile without the PIN', async () => {
    const f = await family();
    const second = await createChildProfile(db, f.accountId, { displayName: 'Leo', ageBand: '10-12', guardianConfirmed: 'on' }, T0);
    if (second.status !== 'created') throw new Error('no second profile');
    await switchToProfile(db, f.session, f.profileId, T0);
    expect(await switchToProfile(db, f.session, second.profileId, T0)).toBe(false);
    expect((await getContext(db, f.session, T0))?.profile?.id).toBe(f.profileId);
  });

  it("the database refuses a session pointing at another account's profile (composite foreign key)", async () => {
    const a = await family();
    const b = await family();
    await expect(
      db.query('UPDATE account_sessions SET active_profile_id = $2 WHERE account_id = $1', [a.accountId, b.profileId]),
    ).rejects.toThrow();
  });
});

describe('switchToAdult', () => {
  it('needs the right PIN; a wrong PIN keeps the child context', async () => {
    const f = await family();
    await switchToProfile(db, f.session, f.profileId, T0);
    expect(await switchToAdult(db, f.session, '0000', T0)).toBe('wrong');
    expect((await getContext(db, f.session, T0))?.profile?.id).toBe(f.profileId);
    expect(await switchToAdult(db, f.session, '1234', T0)).toBe('ok');
    expect((await getContext(db, f.session, T0))?.profile).toBeNull();
  });

  it('locks after 5 wrong PINs, even when the next PIN is right, and the lock is per account', async () => {
    const a = await family();
    const b = await family();
    await switchToProfile(db, a.session, a.profileId, T0);
    await switchToProfile(db, b.session, b.profileId, T0);
    for (let i = 0; i < 5; i++) {
      expect(await switchToAdult(db, a.session, '9999', T0)).toBe('wrong');
    }
    expect(await switchToAdult(db, a.session, '1234', plus(T0, MIN))).toBe('locked');
    expect((await getContext(db, a.session, T0))?.profile?.id).toBe(a.profileId);
    expect(await switchToAdult(db, b.session, '1234', T0)).toBe('ok');
    expect(await switchToAdult(db, a.session, '1234', plus(T0, 16 * MIN))).toBe('ok');
  });

  it('a bad session is wrong', async () => {
    expect(await switchToAdult(db, 'nope', '1234', T0)).toBe('wrong');
  });
});

describe('deleting the active profile', () => {
  it('ends a session still on it (no context at all, fail closed); the adult session stays', async () => {
    const f = await family();
    const adult = (await consumeAccountLink(db, (await requestAccountLink(db, (await getAccount(db, f.session, T0))!.email, env, T0))!, T0))!;
    await switchToProfile(db, f.session, f.profileId, T0);
    expect(await deleteChildProfile(db, f.accountId, f.profileId)).toBe(true);
    expect(await getContext(db, f.session, T0)).toBeNull();
    const ctx = await getContext(db, adult, T0);
    expect(ctx?.account.id).toBe(f.accountId);
    expect(ctx?.profile).toBeNull();
  });
});

describe('isolation between accounts', () => {
  it("a session of account A never yields account B's context or profile", async () => {
    const a = await family();
    const b = await family();
    await switchToProfile(db, b.session, b.profileId, T0);
    const ctx = await getContext(db, a.session, T0);
    expect(ctx?.account.id).toBe(a.accountId);
    expect(ctx?.profile).toBeNull();
    await switchToProfile(db, a.session, a.profileId, T0);
    expect((await getContext(db, a.session, T0))?.profile?.id).toBe(a.profileId);
    expect((await getContext(db, b.session, T0))?.profile?.id).toBe(b.profileId);
    // B's profile still cannot be reached from A's session
    await switchToAdult(db, a.session, '1234', T0);
    expect(await switchToProfile(db, a.session, b.profileId, T0)).toBe(false);
  });
});

describe('requireAdultContext and the adult-only surface', () => {
  it('passes an adult context and rejects a child context and no context', async () => {
    const f = await family();
    const adult = await getContext(db, f.session, T0);
    expect(requireAdultContext(adult)).toBe(adult);
    await switchToProfile(db, f.session, f.profileId, T0);
    expect(requireAdultContext(await getContext(db, f.session, T0))).toBeNull();
    expect(requireAdultContext(null)).toBeNull();
  });

  it('getAccount (behind every existing settings page and route) fails closed for a child context', async () => {
    const f = await family();
    expect((await getAccount(db, f.session, T0))?.id).toBe(f.accountId);
    await switchToProfile(db, f.session, f.profileId, T0);
    expect(await getAccount(db, f.session, T0)).toBeNull();
    await switchToAdult(db, f.session, '1234', T0);
    expect((await getAccount(db, f.session, T0))?.id).toBe(f.accountId);
  });
});

describe('changePin', () => {
  it('needs the current PIN; a wrong one counts toward the lock and changes nothing', async () => {
    const f = await family();
    expect(await changePin(db, f.accountId, '0000', '5678', T0)).toBe('wrong');
    expect(await checkPin(db, f.accountId, '1234', T0)).toBe('ok');
    expect(await changePin(db, f.accountId, '1234', '5678', T0)).toBe('ok');
    expect(await checkPin(db, f.accountId, '5678', T0)).toBe('ok');
    expect(await checkPin(db, f.accountId, '1234', T0)).toBe('wrong');
  });

  it('a locked account cannot change (and so cannot clear the lock), and a bad new PIN is invalid', async () => {
    const f = await family();
    expect(await changePin(db, f.accountId, '1234', '12a4', T0)).toBe('invalid');
    expect(await changePin(db, f.accountId, '1234', undefined, T0)).toBe('invalid');
    for (let i = 0; i < 5; i++) await checkPin(db, f.accountId, '9999', T0);
    expect(await changePin(db, f.accountId, '1234', '5678', T0)).toBe('locked');
    expect(await checkPin(db, f.accountId, '5678', plus(T0, 16 * MIN))).toBe('wrong');
  });

  it('a malformed account id is invalid or wrong, never a write', async () => {
    expect(await changePin(db, 'nope', '1234', '5678', T0)).not.toBe('ok');
  });
});

describe('childCan', () => {
  const table: Record<Capability, boolean> = {
    save_interests: true,
    save_answers: true,
    join_circle: false,
    create_circle: false,
    public_comment: false,
    join_community: false,
    contribute: false,
    create_child_profile: false,
    see_sponsorship: false,
    essential_email: false,
    marketing_email: false,
    invite: false,
    profile_page: false,
  };
  for (const [cap, expected] of Object.entries(table) as [Capability, boolean][]) {
    it(`${cap} -> ${expected}`, () => {
      expect(childCan(cap)).toBe(expected);
    });
  }
});
