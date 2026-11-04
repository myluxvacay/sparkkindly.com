// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { setPin, checkPin } from '@/lib/accounts/pin';

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
beforeEach(async () => {
  await db.query('DELETE FROM accounts');
});

async function adult(): Promise<string> {
  const r = await signUp(db, { email: `pin${n++}@example.test`, dateOfBirth: '1990-05-05' }, T0);
  if (r.status !== 'created') {
    throw new Error('sign-up failed');
  }
  return r.accountId;
}

describe('setPin', () => {
  it('accepts exactly 4 digits and rejects everything else', async () => {
    const id = await adult();
    for (const bad of ['123', '12345', 'abcd', '12 4', '', null, undefined, 1234, ['1234'], '１２３４']) {
      expect(await setPin(db, id, bad), String(bad)).toBe('invalid');
    }
    expect((await db.query('SELECT pin_hash FROM accounts WHERE id = $1', [id])).rows[0]).toEqual({ pin_hash: null });
    expect(await setPin(db, id, '1234')).toBe('set');
  });

  it('stores a salted hash, not the PIN, and the hash differs between accounts with the same PIN', async () => {
    const a = await adult();
    const b = await adult();
    await setPin(db, a, '4821');
    await setPin(db, b, '4821');
    const rows = (await db.query<{ pin_hash: string }>('SELECT pin_hash FROM accounts ORDER BY email')).rows;
    expect(rows[0].pin_hash).not.toBe(rows[1].pin_hash);
    for (const r of rows) {
      expect(r.pin_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]+$/);
      expect(r.pin_hash).not.toContain('4821');
    }
  });

  it('is invalid for an unknown account and changing the PIN resets the lockout', async () => {
    expect(await setPin(db, '00000000-0000-0000-0000-000000000000', '1234')).toBe('invalid');
    const id = await adult();
    await setPin(db, id, '1234');
    for (let i = 0; i < 5; i++) {
      await checkPin(db, id, '0000', T0);
    }
    expect(await checkPin(db, id, '1234', T0)).toBe('locked');
    await setPin(db, id, '5678');
    expect(await checkPin(db, id, '5678', T0)).toBe('ok');
  });
});

describe('checkPin', () => {
  it('ok for the right PIN, wrong for another, wrong when none is set or the input is not a PIN', async () => {
    const id = await adult();
    expect(await checkPin(db, id, '1234', T0)).toBe('wrong');
    await setPin(db, id, '1234');
    expect(await checkPin(db, id, '1234', T0)).toBe('ok');
    expect(await checkPin(db, id, '1235', T0)).toBe('wrong');
    expect(await checkPin(db, id, undefined, T0)).toBe('wrong');
    expect(await checkPin(db, id, { a: 1 }, T0)).toBe('wrong');
  });

  it('five wrong entries lock for 15 minutes even for the correct PIN, then it unlocks', async () => {
    const id = await adult();
    await setPin(db, id, '1234');
    for (let i = 0; i < 5; i++) {
      expect(await checkPin(db, id, '0000', T0)).toBe('wrong');
    }
    expect(await checkPin(db, id, '1234', plus(T0, 14 * MIN))).toBe('locked');
    expect(await checkPin(db, id, '0000', plus(T0, 14 * MIN))).toBe('locked');
    expect(await checkPin(db, id, '1234', plus(T0, 15 * MIN))).toBe('ok');
  });

  it('a correct entry resets the counter', async () => {
    const id = await adult();
    await setPin(db, id, '1234');
    for (let i = 0; i < 4; i++) {
      await checkPin(db, id, '0000', T0);
    }
    expect(await checkPin(db, id, '1234', T0)).toBe('ok');
    for (let i = 0; i < 4; i++) {
      expect(await checkPin(db, id, '0000', T0)).toBe('wrong');
    }
    expect(await checkPin(db, id, '1234', T0)).toBe('ok');
  });

  it('the lock is per account', async () => {
    const a = await adult();
    const b = await adult();
    await setPin(db, a, '1234');
    await setPin(db, b, '1234');
    for (let i = 0; i < 5; i++) {
      await checkPin(db, a, '0000', T0);
    }
    expect(await checkPin(db, a, '1234', T0)).toBe('locked');
    expect(await checkPin(db, b, '1234', T0)).toBe('ok');
  });
});

describe('escalating lock', () => {
  const lockOut = async (id: string, at: Date) => {
    for (let i = 0; i < 5; i++) {
      await checkPin(db, id, '0000', at);
    }
  };
  const HOUR = 60 * MIN;

  it('doubles each lock: 15 min, 30, 60, and a correct PIN while locked is still refused', async () => {
    const id = await adult();
    await setPin(db, id, '1234');
    await lockOut(id, T0);
    expect(await checkPin(db, id, '1234', plus(T0, 14 * MIN))).toBe('locked');
    const t1 = plus(T0, 15 * MIN);
    await lockOut(id, t1);
    expect(await checkPin(db, id, '1234', plus(t1, 29 * MIN))).toBe('locked');
    const t2 = plus(t1, 30 * MIN);
    await lockOut(id, t2);
    expect(await checkPin(db, id, '1234', plus(t2, 59 * MIN))).toBe('locked');
    expect(await checkPin(db, id, '1234', plus(t2, 60 * MIN))).toBe('ok');
  });

  it('is capped at 24 hours', async () => {
    const id = await adult();
    await setPin(db, id, '1234');
    await db.query('UPDATE accounts SET pin_lock_count = 30 WHERE id = $1', [id]);
    await lockOut(id, T0);
    expect(await checkPin(db, id, '1234', plus(T0, 24 * HOUR - MIN))).toBe('locked');
    expect(await checkPin(db, id, '1234', plus(T0, 24 * HOUR))).toBe('ok');
  });

  it('a correct PIN resets the lock count so the next lock is 15 minutes again', async () => {
    const id = await adult();
    await setPin(db, id, '1234');
    await lockOut(id, T0);
    const t1 = plus(T0, 15 * MIN);
    expect(await checkPin(db, id, '1234', t1)).toBe('ok');
    await lockOut(id, t1);
    expect(await checkPin(db, id, '1234', plus(t1, 15 * MIN))).toBe('ok');
  });
});
