// @vitest-environment node
// Circle owner actions and owner-account deletion (plan 4A Task 2). The owner id is the session's account; a slug or a
// member key from a form only names a target, which must be in that owner's own open circle.
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { deleteAccount } from '@/lib/accounts/delete';
import { createCircle, getCircleForMember, leaveCircle } from '@/lib/circles/repo';
import { closeCircle, removeMember, transferOwnership } from '@/lib/circles/owner';
import { addChildToCircle, removeChildFromCircle } from '@/lib/circles/children';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const T1 = new Date('2026-11-02T08:00:00Z');
const JOINED = new Date('2026-11-01T08:01:00Z');
const ADDED = new Date('2026-11-01T08:02:00Z');
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM circles');
  await db.query('DELETE FROM accounts');
});

async function account(dateOfBirth = '1990-05-05'): Promise<string> {
  const r = await signUp(db, { email: `own${n++}@example.test`, dateOfBirth }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  return r.accountId;
}
async function circle(owner: string, kind = 'friends') {
  const r = await createCircle(db, owner, { name: 'Our Circle', kind, yourName: 'Owner' }, T0);
  if (r.status !== 'created') throw new Error('create failed');
  return r.slug;
}
async function join(slug: string, accountId: string, at = JOINED, name = 'Member') {
  await db.query(
    'INSERT INTO circle_members (circle_id, account_id, display_name, joined_at) SELECT id, $2, $3, $4 FROM circles WHERE slug = $1',
    [slug, accountId, name, at.toISOString()],
  );
}
async function child(accountId: string, name = 'Mia') {
  const r = await db.query<{ id: string }>(
    "INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, $2, '6-9') RETURNING id",
    [accountId, name],
  );
  return r.rows[0].id;
}
const snapshot = async () =>
  (
    await db.query(
      `SELECT c.slug, c.status, c.closed_at, c.owner_account_id, m.account_id, m.profile_id, m.role, m.left_at
       FROM circles c LEFT JOIN circle_members m ON m.circle_id = c.id ORDER BY c.slug, m.account_id, m.profile_id`,
    )
  ).rows;
// The invariant every owner action keeps: an open circle has exactly one current owner, and it is owner_account_id.
async function invariant() {
  const bad = await db.query(
    `SELECT c.slug FROM circles c WHERE c.status = 'open' AND (
       c.owner_account_id IS NULL OR
       (SELECT count(*) FROM circle_members m WHERE m.circle_id = c.id AND m.role = 'owner' AND m.left_at IS NULL) <> 1 OR
       NOT EXISTS (SELECT 1 FROM circle_members m WHERE m.circle_id = c.id AND m.role = 'owner' AND m.left_at IS NULL
                   AND m.account_id = c.owner_account_id AND m.profile_id IS NULL))`,
  );
  expect(bad.rows).toEqual([]);
}
const key = (accountId: string, profileId: string | null = null) => ({ accountId, profileId });

describe('removeMember', () => {
  it('the owner removes a member (left_at set, others untouched); a member or a stranger is not_owner', async () => {
    const [o, a, b, s] = [await account(), await account(), await account(), await account()];
    const slug = await circle(o);
    await join(slug, a);
    await join(slug, b);
    expect(await removeMember(db, a, slug, key(b), T1)).toBe('not_owner');
    expect(await removeMember(db, s, slug, key(b), T1)).toBe('not_owner');
    const before = await snapshot();
    expect(await removeMember(db, o, slug, key(b), T1)).toBe('removed');
    const after = await snapshot();
    expect(after.filter((r) => r.account_id !== b)).toEqual(before.filter((r) => r.account_id !== b));
    expect(after.find((r) => r.account_id === b)!.left_at).toEqual(T1);
    expect(await getCircleForMember(db, b, slug)).toBeNull();
    expect(await removeMember(db, o, slug, key(b), T1)).toBe('not_found');
    await invariant();
  });

  it('refuses the owner themself, forged keys and other circles, and changes nothing', async () => {
    const [o, a, other] = [await account(), await account(), await account()];
    const slug = await circle(o);
    const theirs = await circle(other);
    await join(slug, a);
    await join(theirs, a);
    const before = await snapshot();
    expect(await removeMember(db, o, slug, key(o), T1)).toBe('is_owner');
    expect(await removeMember(db, o, theirs, key(a), T1)).toBe('not_owner');
    for (const k of [key('nope'), key(other), key(a, '00000000-0000-0000-0000-000000000000'), key(a, 'x')]) {
      expect(await removeMember(db, o, slug, k, T1), JSON.stringify(k)).toBe('not_found');
    }
    expect(await removeMember(db, o, 'zzzzzzzzzz', key(a), T1)).toBe('not_owner');
    expect(await removeMember(db, 'nope', slug, key(a), T1)).toBe('not_owner');
    expect(await snapshot()).toEqual(before);
  });

  it("removing an adult also takes out their child profiles; removing a child leaves its adult", async () => {
    const [o, a] = [await account(), await account()];
    const slug = await circle(o, 'family');
    await join(slug, a);
    const mia = await child(a);
    const leo = await child(a, 'Leo');
    expect(await addChildToCircle(db, a, slug, mia, 'on', ADDED)).toBe('added');
    expect(await addChildToCircle(db, a, slug, leo, 'on', ADDED)).toBe('added');
    expect(await removeMember(db, o, slug, key(a, mia), T1)).toBe('removed');
    expect((await getCircleForMember(db, a, slug))!.members.map((m) => m.name)).toEqual(['Owner', 'Member', 'Leo']);
    expect(await removeMember(db, o, slug, key(a), T1)).toBe('removed');
    expect((await getCircleForMember(db, o, slug))!.members.map((m) => m.name)).toEqual(['Owner']);
  });
});

describe('transferOwnership', () => {
  it('passes ownership to a current adult account member; the old owner becomes a member and may leave', async () => {
    const [o, a] = [await account(), await account()];
    const slug = await circle(o);
    await join(slug, a);
    expect(await transferOwnership(db, a, slug, o, T1)).toBe('not_owner');
    expect(await transferOwnership(db, await account(), slug, a, T1)).toBe('not_owner');
    expect(await transferOwnership(db, o, slug, a, T1)).toBe('transferred');
    await invariant();
    expect((await getCircleForMember(db, a, slug))!.myRole).toBe('owner');
    expect((await getCircleForMember(db, o, slug))!.myRole).toBe('member');
    expect(await transferOwnership(db, o, slug, a, T1)).toBe('not_owner');
    expect(await leaveCircle(db, o, slug, T1)).toBe('left');
  });

  it('refuses a teen, a non-member, a left member, a child profile id, self and a malformed id', async () => {
    const [o, teen, left, stranger] = [await account(), await account('2010-01-01'), await account(), await account()];
    const slug = await circle(o, 'family');
    await join(slug, teen);
    await join(slug, left);
    await db.query('UPDATE circle_members SET left_at = $2 WHERE account_id = $1', [left, T0.toISOString()]);
    const mia = await child(o);
    expect(await addChildToCircle(db, o, slug, mia, 'on', T0)).toBe('has_teen');
    const before = await snapshot();
    for (const to of [teen, left, stranger, o, mia, 'nope']) {
      expect(await transferOwnership(db, o, slug, to, T1), to).toBe('not_eligible');
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe('closeCircle', () => {
  it('only the owner closes; a closed circle accepts no further writes but stays readable', async () => {
    const [o, a] = [await account(), await account()];
    const slug = await circle(o, 'family');
    await join(slug, a);
    expect(await closeCircle(db, a, slug, T1)).toBe('not_owner');
    expect(await closeCircle(db, o, slug, T1)).toBe('closed');
    const c = (await db.query('SELECT status, closed_at FROM circles WHERE slug = $1', [slug])).rows[0];
    expect(c).toEqual({ status: 'closed', closed_at: T1 });
    const before = await snapshot();
    expect(await closeCircle(db, o, slug, new Date(T1.getTime() + 1000))).toBe('closed');
    expect(await removeMember(db, o, slug, key(a), T1)).toBe('closed');
    expect(await transferOwnership(db, o, slug, a, T1)).toBe('closed');
    const mia = await child(a);
    expect(await addChildToCircle(db, a, slug, mia, 'on', T1)).toBe('not_allowed');
    expect(await removeChildFromCircle(db, a, slug, mia, T1)).toBe(false);
    expect(await snapshot()).toEqual(before);
    expect((await getCircleForMember(db, a, slug))!.status).toBe('closed');
  });
});

describe('races keep exactly one owner on an open circle', () => {
  it('leave vs remove of the same member', async () => {
    const [o, a] = [await account(), await account()];
    const slug = await circle(o);
    await join(slug, a);
    const [left, removed] = await Promise.all([leaveCircle(db, a, slug, T1), removeMember(db, o, slug, key(a), T1)]);
    expect([left, removed].filter((r) => r === 'left' || r === 'removed')).toHaveLength(1);
    await invariant();
  });

  it('transfer vs close', async () => {
    const [o, a] = [await account(), await account()];
    const slug = await circle(o);
    await join(slug, a);
    const [t, c] = await Promise.all([transferOwnership(db, o, slug, a, T1), closeCircle(db, o, slug, T1)]);
    expect(['transferred', 'closed']).toContain(t);
    expect(['closed', 'not_owner']).toContain(c);
    await invariant();
  });

  it('two transfers to different members', async () => {
    const [o, a, b] = [await account(), await account(), await account()];
    const slug = await circle(o);
    await join(slug, a);
    await join(slug, b);
    const r = await Promise.all([transferOwnership(db, o, slug, a, T1), transferOwnership(db, o, slug, b, T1)]);
    expect(r.filter((x) => x === 'transferred')).toHaveLength(1);
    await invariant();
  });
});

describe('deleting the owner account', () => {
  it('hands ownership to the longest-standing other adult account member', async () => {
    const [o, teen, early, late] = [await account(), await account('2010-01-01'), await account(), await account()];
    const slug = await circle(o);
    await join(slug, teen, new Date('2026-10-01T00:00:00Z'));
    await join(slug, late, new Date('2026-11-01T09:00:00Z'));
    await join(slug, early, new Date('2026-11-01T08:30:00Z'));
    expect(await deleteAccount(db, o)).toBe(true);
    await invariant();
    expect((await getCircleForMember(db, early, slug))!.myRole).toBe('owner');
    expect((await getCircleForMember(db, late, slug))!.myRole).toBe('member');
  });

  it('with no other adult account member the circle is closed (never ownerless and open), and members can still read it', async () => {
    const [o, teen] = [await account(), await account('2010-01-01')];
    const slug = await circle(o);
    await join(slug, teen);
    const lone = await circle(o, 'family');
    expect(await deleteAccount(db, o)).toBe(true);
    await invariant();
    const rows = (await db.query('SELECT slug, status, owner_account_id, closed_at FROM circles ORDER BY slug')).rows;
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ status: 'closed', owner_account_id: null });
    expect((await getCircleForMember(db, teen, slug))!.status).toBe('closed');
    expect(await getCircleForMember(db, teen, lone)).toBeNull();
  });

  it("a member's deletion removes every one of their circle rows (and their children's) and nobody else's", async () => {
    const [o, a] = [await account(), await account()];
    const slug = await circle(o, 'family');
    await join(slug, a);
    const mia = await child(a);
    expect(await addChildToCircle(db, a, slug, mia, 'on', T0)).toBe('added');
    expect(await deleteAccount(db, a)).toBe(true);
    expect((await db.query('SELECT 1 FROM circle_members WHERE account_id = $1', [a])).rows).toHaveLength(0);
    expect((await getCircleForMember(db, o, slug))!.members.map((m) => m.name)).toEqual(['Owner']);
  });

  it('an owner with a closed circle can be deleted; the closed circle loses its owner', async () => {
    const [o, a] = [await account(), await account()];
    const slug = await circle(o);
    await join(slug, a);
    expect(await closeCircle(db, o, slug, T1)).toBe('closed');
    expect(await deleteAccount(db, o)).toBe(true);
    expect((await db.query('SELECT status, owner_account_id FROM circles WHERE slug = $1', [slug])).rows[0]).toEqual({
      status: 'closed',
      owner_account_id: null,
    });
  });
});
