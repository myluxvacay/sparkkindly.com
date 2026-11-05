// @vitest-environment node
// Child profiles in family circles (plan 4A Task 2): only the profile's own adult, only into a family circle that adult
// belongs to, only with the confirmation, never alongside a 13-17 member.
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { createCircle, getCircleForMember } from '@/lib/circles/repo';
import { LIMITS } from '@/lib/circles/rules';
import { addChildToCircle, circleHasChild, removeChildFromCircle } from '@/lib/circles/children';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const T1 = new Date('2026-11-02T08:00:00Z');
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
  const r = await signUp(db, { email: `kidc${n++}@example.test`, dateOfBirth }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  return r.accountId;
}
async function circle(owner: string, kind = 'family') {
  const r = await createCircle(db, owner, { name: 'Home', kind, yourName: 'Mum' }, T0);
  if (r.status !== 'created') throw new Error('create failed');
  return r.slug;
}
async function join(slug: string, accountId: string) {
  await db.query(
    "INSERT INTO circle_members (circle_id, account_id, display_name) SELECT id, $2, 'Member' FROM circles WHERE slug = $1",
    [slug, accountId],
  );
}
async function child(accountId: string, name = 'Mia') {
  const r = await db.query<{ id: string }>(
    "INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, $2, '6-9') RETURNING id",
    [accountId, name],
  );
  return r.rows[0].id;
}
const circleId = async (slug: string) =>
  (await db.query<{ id: string }>('SELECT id FROM circles WHERE slug = $1', [slug])).rows[0].id;
const rows = async () => (await db.query('SELECT * FROM circle_members ORDER BY joined_at, account_id')).rows;

describe('addChildToCircle', () => {
  it("adds the adult's own child under the profile's display name, with the confirmation", async () => {
    const a = await account();
    const slug = await circle(a);
    const mia = await child(a);
    expect(await circleHasChild(db, await circleId(slug))).toBe(false);
    expect(await addChildToCircle(db, a, slug, mia, 'on', T1)).toBe('added');
    expect(await circleHasChild(db, await circleId(slug))).toBe(true);
    const v = await getCircleForMember(db, a, slug);
    expect(v!.members.map((m) => [m.name, m.role, m.isChild])).toEqual([
      ['Mum', 'owner', false],
      ['Mia', 'member', true],
    ]);
    expect(await addChildToCircle(db, a, slug, mia, 'on', T1)).toBe('already');
  });

  it('needs the confirmation checkbox, and malformed ids are invalid', async () => {
    const a = await account();
    const slug = await circle(a);
    const mia = await child(a);
    for (const c of [undefined, '', 'off', 'yes', false, null, ['on']]) {
      expect(await addChildToCircle(db, a, slug, mia, c, T1), String(c)).toBe('invalid');
    }
    expect(await addChildToCircle(db, a, slug, 'nope', 'on', T1)).toBe('invalid');
    expect(await addChildToCircle(db, 'nope', slug, mia, 'on', T1)).toBe('invalid');
    expect(await circleHasChild(db, await circleId(slug))).toBe(false);
  });

  it('only into a family circle', async () => {
    const a = await account();
    const mia = await child(a);
    for (const kind of ['friends', 'community']) {
      expect(await addChildToCircle(db, a, await circle(a, kind), mia, 'on', T1)).toBe('not_family');
    }
  });

  it("not by another adult, not with another account's profile, not into a circle the adult is not in", async () => {
    const [a, b, s] = [await account(), await account(), await account()];
    const slug = await circle(a);
    await join(slug, b);
    const mia = await child(a);
    const zed = await child(s, 'Zed');
    const before = await rows();
    expect(await addChildToCircle(db, b, slug, mia, 'on', T1)).toBe('not_allowed');
    expect(await addChildToCircle(db, a, slug, zed, 'on', T1)).toBe('not_allowed');
    expect(await addChildToCircle(db, s, slug, zed, 'on', T1)).toBe('not_allowed');
    expect(await addChildToCircle(db, a, 'zzzzzzzzzz', mia, 'on', T1)).toBe('not_allowed');
    expect(await rows()).toEqual(before);
  });

  it('a circle with a 13-17 member is has_teen; a hidden circle is not_allowed', async () => {
    const a = await account();
    const slug = await circle(a);
    await join(slug, await account('2010-01-01'));
    const mia = await child(a);
    expect(await addChildToCircle(db, a, slug, mia, 'on', T1)).toBe('has_teen');
    const other = await circle(a);
    await db.query('UPDATE circles SET hidden_at = $2 WHERE slug = $1', [other, T0.toISOString()]);
    expect(await addChildToCircle(db, a, other, mia, 'on', T1)).toBe('not_allowed');
  });

  it(`a circle holds at most ${LIMITS.members} members`, async () => {
    const a = await account();
    const slug = await circle(a);
    for (let i = 1; i < LIMITS.members; i++) await join(slug, await account());
    expect(await addChildToCircle(db, a, slug, await child(a), 'on', T1)).toBe('limit');
  });

  it('a removed child can be added back', async () => {
    const a = await account();
    const slug = await circle(a);
    const mia = await child(a);
    expect(await addChildToCircle(db, a, slug, mia, 'on', T1)).toBe('added');
    expect(await removeChildFromCircle(db, a, slug, mia, T1)).toBe(true);
    expect(await addChildToCircle(db, a, slug, mia, 'on', T1)).toBe('added');
    expect((await getCircleForMember(db, a, slug))!.members).toHaveLength(2);
  });
});

describe('removeChildFromCircle', () => {
  it("only the child's own adult removes it; forged ids change nothing", async () => {
    const [a, b] = [await account(), await account()];
    const slug = await circle(a);
    await join(slug, b);
    const mia = await child(a);
    expect(await addChildToCircle(db, a, slug, mia, 'on', T1)).toBe('added');
    const before = await rows();
    expect(await removeChildFromCircle(db, b, slug, mia, T1)).toBe(false);
    expect(await removeChildFromCircle(db, a, slug, 'nope', T1)).toBe(false);
    expect(await removeChildFromCircle(db, a, 'zzzzzzzzzz', mia, T1)).toBe(false);
    expect(await rows()).toEqual(before);
    expect(await removeChildFromCircle(db, a, slug, mia, T1)).toBe(true);
    expect(await removeChildFromCircle(db, a, slug, mia, T1)).toBe(false);
    expect(await circleHasChild(db, await circleId(slug))).toBe(false);
  });

  it('deleting the child profile removes its circle rows', async () => {
    const a = await account();
    const slug = await circle(a);
    const mia = await child(a);
    expect(await addChildToCircle(db, a, slug, mia, 'on', T1)).toBe('added');
    await db.query('DELETE FROM child_profiles WHERE id = $1', [mia]);
    expect((await db.query('SELECT 1 FROM circle_members WHERE profile_id = $1', [mia])).rows).toHaveLength(0);
  });
});
