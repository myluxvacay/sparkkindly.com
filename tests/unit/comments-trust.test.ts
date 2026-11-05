// @vitest-environment node
// Comments (plan 7A Task 1): the trust ladder. Five approvals reach level 1; a rejection drops a level and resets the
// approved count; the owner sets a level or bans by hand.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { getTrust, recordApproval, recordRejection, setTrust } from '@/lib/comments/trust';

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

async function account(): Promise<string> {
  const r = await signUp(db, { email: `trust${n++}@example.test`, dateOfBirth: '1990-05-05' }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  return r.accountId;
}

describe('trust ladder', () => {
  it('starts every account at level 0, not banned, with no name chosen', async () => {
    expect(await getTrust(db, await account())).toEqual({
      level: 0,
      approved: 0,
      rejected: 0,
      banned: false,
      displayName: null,
      guidelinesAcceptedAt: null,
    });
  });

  it('moves to level 1 on the fifth approval, not before', async () => {
    const id = await account();
    for (let i = 0; i < 4; i++) await db.transaction((tx) => recordApproval(tx, id));
    expect(await getTrust(db, id)).toMatchObject({ level: 0, approved: 4 });
    await db.transaction((tx) => recordApproval(tx, id));
    expect(await getTrust(db, id)).toMatchObject({ level: 1, approved: 5 });
  });

  it('a rejection drops a level and resets the approved count; five more approvals are needed', async () => {
    const id = await account();
    for (let i = 0; i < 5; i++) await db.transaction((tx) => recordApproval(tx, id));
    await db.transaction((tx) => recordRejection(tx, id));
    expect(await getTrust(db, id)).toMatchObject({ level: 0, approved: 0, rejected: 1 });
    for (let i = 0; i < 4; i++) await db.transaction((tx) => recordApproval(tx, id));
    expect((await getTrust(db, id)).level).toBe(0);
    await db.transaction((tx) => recordRejection(tx, id));
    expect(await getTrust(db, id)).toMatchObject({ level: 0, approved: 0, rejected: 2 });
  });

  it('the owner sets a level and bans; an unknown or malformed account changes nothing', async () => {
    const id = await account();
    expect(await db.transaction((tx) => setTrust(tx, id, { level: 1 }))).toBe(true);
    expect((await getTrust(db, id)).level).toBe(1);
    expect(await db.transaction((tx) => setTrust(tx, id, { banned: true }))).toBe(true);
    expect(await getTrust(db, id)).toMatchObject({ level: 1, banned: true });
    expect(await db.transaction((tx) => setTrust(tx, id, { level: 0, banned: false }))).toBe(true);
    expect(await getTrust(db, id)).toMatchObject({ level: 0, banned: false });
    expect(await db.transaction((tx) => setTrust(tx, '00000000-0000-0000-0000-000000000001', { banned: true }))).toBe(false);
    expect(await db.transaction((tx) => setTrust(tx, 'nope', { banned: true }))).toBe(false);
    expect(await db.transaction((tx) => setTrust(tx, id, { level: 2 as 1 }))).toBe(false);
  });

  it('the trust row goes with the account', async () => {
    const id = await account();
    await db.transaction((tx) => setTrust(tx, id, { level: 1 }));
    await db.query('DELETE FROM accounts WHERE id = $1', [id]);
    expect((await db.query('SELECT count(*)::int AS n FROM account_trust')).rows[0]).toEqual({ n: 0 });
  });
});
