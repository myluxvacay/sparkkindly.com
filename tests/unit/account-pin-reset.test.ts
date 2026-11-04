// @vitest-environment node
// PIN reset after a fresh email sign-in (plan 3E Task 2): adult context only, session created within 10 minutes, a valid
// 4-digit PIN; it clears the lock fields and nothing else.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { requestAccountLink, consumeAccountLink } from '@/lib/accounts/sessions';
import { createChildProfile } from '@/lib/accounts/children';
import { checkPin } from '@/lib/accounts/pin';
import { getContext, switchToProfile } from '@/lib/accounts/context';
import { resetPin } from '@/lib/accounts/pin-reset';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const MIN = 60_000;
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

// An adult account with PIN 1234 (set with its child profile) and a session signed in at T0.
async function family() {
  const email = `reset${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth: '1990-05-05' }, T0);
  if (r.status !== 'created') {
    throw new Error('sign-up failed');
  }
  const p = await createChildProfile(
    db,
    r.accountId,
    { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: 'on', pin: '1234' },
    T0,
  );
  if (p.status !== 'created') {
    throw new Error('profile not created');
  }
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, T0))!, T0))!;
  return { accountId: r.accountId, profileId: p.profileId, session };
}
const lockFields = async (id: string) =>
  (
    await db.query<{ pin_failures: number; pin_lock_count: number; pin_locked_until: Date | null }>(
      'SELECT pin_failures, pin_lock_count, pin_locked_until FROM accounts WHERE id = $1',
      [id],
    )
  ).rows[0];

describe('resetPin', () => {
  it('sets a new PIN without the old one 9 minutes after sign-in', async () => {
    const f = await family();
    const at = plus(T0, 9 * MIN);
    expect(await resetPin(db, f.session, '5678', at)).toBe('ok');
    expect(await checkPin(db, f.accountId, '5678', at)).toBe('ok');
    expect(await checkPin(db, f.accountId, '1234', at)).toBe('wrong');
  });

  it('is stale 11 minutes after sign-in and leaves the PIN unchanged', async () => {
    const f = await family();
    const at = plus(T0, 11 * MIN);
    expect(await resetPin(db, f.session, '5678', at)).toBe('stale');
    expect(await checkPin(db, f.accountId, '1234', at)).toBe('ok');
  });

  it('is not allowed in a child context, even with a fresh session', async () => {
    const f = await family();
    expect(await switchToProfile(db, f.session, f.profileId, T0)).toBe(true);
    expect(await resetPin(db, f.session, '5678', plus(T0, MIN))).toBe('not_allowed');
    expect(await resetPin(db, f.session, 'nope', plus(T0, MIN))).toBe('not_allowed');
    expect(await checkPin(db, f.accountId, '1234', plus(T0, MIN))).toBe('ok');
  });

  it('is not allowed without a session or with a bad token', async () => {
    for (const bad of ['', 'nope', 'a'.repeat(64), undefined as unknown as string]) {
      expect(await resetPin(db, bad, '5678', T0)).toBe('not_allowed');
    }
  });

  it('rejects a PIN that is not exactly 4 digits and keeps the old one', async () => {
    const f = await family();
    for (const bad of ['123', '12345', 'abcd', '', null, undefined, 1234, ['1234']]) {
      expect(await resetPin(db, f.session, bad, plus(T0, MIN)), String(bad)).toBe('invalid');
    }
    expect(await checkPin(db, f.accountId, '1234', plus(T0, MIN))).toBe('ok');
  });

  it('clears a lock, the failure count and the lock count, and leaves sessions alone', async () => {
    const f = await family();
    const other = (await consumeAccountLink(db, (await requestAccountLink(db, `reset${n - 1}@example.test`, {}, T0))!, T0))!;
    await db.query('UPDATE accounts SET pin_lock_count = 3 WHERE id = $1', [f.accountId]);
    for (let i = 0; i < 5; i++) {
      await checkPin(db, f.accountId, '0000', T0);
    }
    await checkPin(db, f.accountId, '0000', T0);
    expect(await checkPin(db, f.accountId, '1234', plus(T0, MIN))).toBe('locked');
    const at = plus(T0, 5 * MIN);
    expect(await resetPin(db, f.session, '5678', at)).toBe('ok');
    expect(await lockFields(f.accountId)).toEqual({ pin_failures: 0, pin_lock_count: 0, pin_locked_until: null });
    expect(await checkPin(db, f.accountId, '5678', at)).toBe('ok');
    expect((await getContext(db, other, at))?.account.id).toBe(f.accountId);
    expect((await getContext(db, f.session, at))?.profile).toBeNull();
  });
});
