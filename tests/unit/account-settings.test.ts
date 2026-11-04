// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { getSettings, saveSettings } from '@/lib/accounts/settings';

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

async function adult(timeZone = 'Europe/London'): Promise<string> {
  const r = await signUp(db, { email: `s${n++}@example.test`, dateOfBirth: '1990-05-05', timeZone }, T0);
  if (r.status !== 'created') {
    throw new Error('sign-up failed');
  }
  return r.accountId;
}
const OFF = { dailySet: false, weeklyCircle: false, invites: false };

describe('getSettings', () => {
  it('returns the sign-up time zone and every notification off by default', async () => {
    const id = await adult();
    expect(await getSettings(db, id)).toEqual({ timeZone: 'Europe/London', notify: OFF });
  });

  it('returns null for an unknown or malformed account id', async () => {
    expect(await getSettings(db, '00000000-0000-0000-0000-000000000001')).toBeNull();
    expect(await getSettings(db, 'not-a-uuid')).toBeNull();
  });
});

describe('saveSettings', () => {
  it('saves the time zone and preferences and reads them back', async () => {
    const id = await adult();
    const r = await saveSettings(db, id, {
      timeZone: 'America/New_York',
      notify: { dailySet: true, weeklyCircle: false, invites: true },
    });
    expect(r).toBe('ok');
    expect(await getSettings(db, id)).toEqual({
      timeZone: 'America/New_York',
      notify: { dailySet: true, weeklyCircle: false, invites: true },
    });
  });

  it('accepts UTC and a partial notify object, leaving the other keys as they were', async () => {
    const id = await adult();
    await saveSettings(db, id, { notify: { invites: true } });
    expect(await saveSettings(db, id, { timeZone: 'UTC', notify: { dailySet: true } })).toBe('ok');
    expect(await getSettings(db, id)).toEqual({
      timeZone: 'UTC',
      notify: { dailySet: true, weeklyCircle: false, invites: true },
    });
  });

  it('an invalid time zone is refused and the old one kept, with nothing else written', async () => {
    const id = await adult();
    for (const timeZone of ['Mars/Olympus', '', 42, null]) {
      expect(await saveSettings(db, id, { timeZone, notify: { dailySet: true } })).toBe('invalid');
    }
    expect(await getSettings(db, id)).toEqual({ timeZone: 'Europe/London', notify: OFF });
  });

  it('a non-boolean preference is invalid', async () => {
    const id = await adult();
    for (const v of ['true', 1, null, 'on']) {
      expect(await saveSettings(db, id, { notify: { dailySet: v } })).toBe('invalid');
    }
    expect(await saveSettings(db, id, { notify: 'yes' })).toBe('invalid');
    expect(await saveSettings(db, id, { notify: [true] })).toBe('invalid');
    expect((await getSettings(db, id))?.notify).toEqual(OFF);
  });

  it('an unknown key, at the top level or in notify, is invalid', async () => {
    const id = await adult();
    expect(await saveSettings(db, id, { notify: { dailySet: true, marketing: true } })).toBe('invalid');
    expect(
      await saveSettings(db, id, { timeZone: 'UTC', email: 'x@example.test' } as unknown as { timeZone: unknown }),
    ).toBe('invalid');
    expect(await getSettings(db, id)).toEqual({ timeZone: 'Europe/London', notify: OFF });
  });

  it('an unknown or malformed account is invalid', async () => {
    expect(await saveSettings(db, '00000000-0000-0000-0000-000000000001', { timeZone: 'UTC' })).toBe('invalid');
    expect(await saveSettings(db, 'nope', { timeZone: 'UTC' })).toBe('invalid');
  });

  it('changes only the caller account', async () => {
    const a = await adult();
    const b = await adult();
    await saveSettings(db, a, { timeZone: 'Asia/Tokyo', notify: { dailySet: true } });
    expect(await getSettings(db, b)).toEqual({ timeZone: 'Europe/London', notify: OFF });
  });
});
