// @vitest-environment node
// Public leaderboard profile (Project 4.11, ADR 0004): opt-in defaults off; a save validates the whole input
// before anything is written; the public name passes the blocked-words gate; opting out keeps name and avatar.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { getLeaderboardProfile, saveLeaderboardProfile } from '@/lib/accounts/leaderboard';

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

async function adult(): Promise<string> {
  const r = await signUp(db, { email: `lb${n++}@example.test`, dateOfBirth: '1990-05-05' }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  return r.accountId;
}

describe('leaderboard profile', () => {
  it('defaults to opted out with no name or avatar', async () => {
    const id = await adult();
    expect(await getLeaderboardProfile(db, id)).toEqual({ optIn: false, publicName: null, avatarKey: null });
  });

  it('saves an opt-in with a cleaned name and a chosen avatar', async () => {
    const id = await adult();
    const r = await saveLeaderboardProfile(db, id, { optIn: true, publicName: '  Sunny   Sam ', avatarKey: 'wave' });
    expect(r).toBe('ok');
    expect(await getLeaderboardProfile(db, id)).toEqual({ optIn: true, publicName: 'Sunny Sam', avatarKey: 'wave' });
  });

  it('falls back to the default avatar for an unknown key', async () => {
    const id = await adult();
    expect(await saveLeaderboardProfile(db, id, { optIn: true, publicName: 'Sam', avatarKey: 'nope' })).toBe('ok');
    expect((await getLeaderboardProfile(db, id))?.avatarKey).toBe('spark');
  });

  it('refuses a blocked name and an over-long name without writing', async () => {
    const id = await adult();
    expect(await saveLeaderboardProfile(db, id, { optIn: true, publicName: 'oh shit', avatarKey: 'wave' })).toBe('blocked');
    expect(await saveLeaderboardProfile(db, id, { optIn: true, publicName: 'x'.repeat(31), avatarKey: 'wave' })).toBe('invalid');
    expect(await getLeaderboardProfile(db, id)).toEqual({ optIn: false, publicName: null, avatarKey: null });
  });

  it('opting out turns the flag off and keeps the name and avatar', async () => {
    const id = await adult();
    await saveLeaderboardProfile(db, id, { optIn: true, publicName: 'Sam', avatarKey: 'leaf' });
    expect(await saveLeaderboardProfile(db, id, { optIn: false })).toBe('ok');
    expect(await getLeaderboardProfile(db, id)).toEqual({ optIn: false, publicName: 'Sam', avatarKey: 'leaf' });
  });
});
