// @vitest-environment node
// Join rules (plan 4B Task 1): the one set of rules shared by invite acceptance and community joining.
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import type { AgeGroup, Consent } from '@/lib/accounts/policy';
import { createCircle } from '@/lib/circles/repo';
import { LIMITS } from '@/lib/circles/rules';
import { canJoin, joinCircle, type JoinInput } from '@/lib/circles/join';
import { COMMUNITY_PAGE, joinCommunity, listCommunities } from '@/lib/circles/communities';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
let n = 0;

const base: JoinInput = {
  group: 'adult',
  consent: 'none',
  circleKind: 'friends',
  circleHasChild: false,
  viaInvite: true,
  memberCount: 1,
  accountCircleCount: 0,
  alreadyMember: false,
  circleOpen: true,
  circleHidden: false,
};

describe('canJoin', () => {
  const people: [AgeGroup, Consent][] = [
    ['adult', 'none'],
    ['teen_16_17', 'none'],
    ['teen_13_15', 'confirmed'],
    ['teen_13_15', 'pending'],
    ['under_13', 'none'],
  ];
  // [group, consent, kind, hasChild, viaInvite] -> expected
  const table: [AgeGroup, Consent, JoinInput['circleKind'], boolean, boolean, string][] = [];
  for (const [g, c] of people) {
    for (const kind of ['friends', 'family', 'community'] as const) {
      for (const hasChild of [false, true]) {
        for (const via of [true, false]) {
          let want = 'ok';
          if (g === 'under_13' || (g === 'teen_13_15' && c !== 'confirmed')) want = 'capability';
          else if (kind === 'community' && g === 'teen_13_15') want = 'community_age';
          else if (kind !== 'community' && !via) want = 'invite_only';
          else if (hasChild && g !== 'adult') want = 'has_child_adults_only';
          table.push([g, c, kind, hasChild, via, want]);
        }
      }
    }
  }
  it.each(table)('%s/%s into %s (child %s, invite %s): %s', (group, consent, circleKind, circleHasChild, viaInvite, want) => {
    const r = canJoin({ ...base, group, consent, circleKind, circleHasChild, viaInvite });
    expect(r.ok ? 'ok' : r.reason).toBe(want);
  });

  it('refuses a closed, hidden or full circle, an existing member and an account at its circle limit', () => {
    const reason = (over: Partial<JoinInput>) => {
      const r = canJoin({ ...base, ...over });
      return r.ok ? 'ok' : r.reason;
    };
    expect(reason({ circleOpen: false })).toBe('closed');
    expect(reason({ circleHidden: true })).toBe('closed');
    expect(reason({ alreadyMember: true })).toBe('already_member');
    expect(reason({ removed: true })).toBe('removed');
    expect(reason({ memberCount: LIMITS.members })).toBe('full');
    expect(reason({ memberCount: LIMITS.members - 1 })).toBe('ok');
    expect(reason({ accountCircleCount: LIMITS.memberOf })).toBe('account_limit');
    expect(reason({ accountCircleCount: LIMITS.memberOf - 1 })).toBe('ok');
    // A closed circle never says more than "closed", even to someone who could not join it anyway.
    expect(reason({ circleOpen: false, group: 'under_13', alreadyMember: true })).toBe('closed');
  });
});

describe('joinCircle', () => {
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

  async function account(dateOfBirth = '1990-05-05', consent?: Consent): Promise<string> {
    const teen = dateOfBirth.startsWith('2012');
    const r = await signUp(
      db,
      { email: `join${n++}@example.test`, dateOfBirth, parentEmail: teen ? `p${n++}@example.test` : undefined },
      T0,
    );
    if (r.status !== 'created') throw new Error('sign-up failed');
    if (consent) await db.query('UPDATE accounts SET consent_state = $2 WHERE id = $1', [r.accountId, consent]);
    return r.accountId;
  }
  async function circle(owner: string, kind = 'friends') {
    const r = await createCircle(db, owner, { name: 'Club', kind, yourName: 'Owner' }, T0);
    if (r.status !== 'created') throw new Error(`create failed: ${r.status}`);
    const id = (await db.query<{ id: string }>('SELECT id FROM circles WHERE slug = $1', [r.slug])).rows[0].id;
    return { slug: r.slug, id };
  }
  const members = async (circleId: string) =>
    (await db.query('SELECT account_id, display_name, role, left_at FROM circle_members WHERE circle_id = $1', [circleId])).rows;

  it('adds the account as a member under the name it typed, once', async () => {
    const c = await circle(await account());
    const b = await account();
    expect(await joinCircle(db, b, c.id, '  Bea ', true, T0)).toEqual({ status: 'joined', slug: c.slug });
    expect(await members(c.id)).toContainEqual({ account_id: b, display_name: 'Bea', role: 'member', left_at: null });
    expect(await joinCircle(db, b, c.id, 'Bea', true, T0)).toEqual({ status: 'already_member' });
  });

  it('requires a valid name (1 to 30 characters, no blocked word, no address)', async () => {
    const c = await circle(await account());
    const b = await account();
    for (const bad of ['', '   ', 'x'.repeat(31), 'a@b.test', 42]) {
      expect(await joinCircle(db, b, c.id, bad, true, T0)).toEqual({ status: 'name' });
    }
    expect(await members(c.id)).toHaveLength(1);
  });

  it('re-derives age and consent from the account row: pending teen and a teen into a child circle refused', async () => {
    const owner = await account();
    const fam = await circle(owner, 'family');
    const kid = await db.query<{ id: string }>(
      "INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, 'Mia', '6-9') RETURNING id",
      [owner],
    );
    await db.query("INSERT INTO circle_members (circle_id, account_id, profile_id, display_name) VALUES ($1, $2, $3, 'Mia')", [
      fam.id,
      owner,
      kid.rows[0].id,
    ]);
    const older = await account('2010-01-01');
    expect(await joinCircle(db, older, fam.id, 'Teen', true, T0)).toEqual({ status: 'has_child_adults_only' });
    const pending = await account('2012-01-01');
    const friends = await circle(owner);
    expect(await joinCircle(db, pending, friends.id, 'Kid', true, T0)).toEqual({ status: 'capability' });
    const confirmed = await account('2012-01-01', 'confirmed');
    expect(await joinCircle(db, confirmed, friends.id, 'Kid', true, T0)).toEqual({ status: 'joined', slug: friends.slug });
  });

  it('refuses a friends circle without an invite, and a closed or hidden one', async () => {
    const owner = await account();
    const c = await circle(owner);
    const b = await account();
    expect(await joinCircle(db, b, c.id, 'Bea', false, T0)).toEqual({ status: 'invite_only' });
    await db.query('UPDATE circles SET hidden_at = $2 WHERE id = $1', [c.id, T0.toISOString()]);
    expect(await joinCircle(db, b, c.id, 'Bea', true, T0)).toEqual({ status: 'closed' });
    await db.query("UPDATE circles SET hidden_at = NULL, status = 'closed', closed_at = $2 WHERE id = $1", [c.id, T0.toISOString()]);
    expect(await joinCircle(db, b, c.id, 'Bea', true, T0)).toEqual({ status: 'closed' });
    expect(await joinCircle(db, b, '00000000-0000-0000-0000-000000000000', 'Bea', true, T0)).toEqual({ status: 'closed' });
    expect(await joinCircle(db, 'not-a-uuid', c.id, 'Bea', true, T0)).toEqual({ status: 'closed' });
  });

  it('refuses a full circle and an account at its circle limit', async () => {
    const owner = await account();
    const c = await circle(owner);
    for (let i = 1; i < LIMITS.members; i++) {
      await db.query("INSERT INTO circle_members (circle_id, account_id, display_name) VALUES ($1, $2, 'M')", [c.id, await account()]);
    }
    expect(await joinCircle(db, await account(), c.id, 'Late', true, T0)).toEqual({ status: 'full' });

    const busy = await account();
    for (let i = 0; i < LIMITS.memberOf; i++) {
      const other = await circle(await account());
      await db.query("INSERT INTO circle_members (circle_id, account_id, display_name) VALUES ($1, $2, 'B')", [other.id, busy]);
    }
    const next = await circle(owner);
    expect(await joinCircle(db, busy, next.id, 'Busy', true, T0)).toEqual({ status: 'account_limit' });
  });

  it('a member who left joins again on the same row', async () => {
    const c = await circle(await account());
    const b = await account();
    await joinCircle(db, b, c.id, 'Bea', true, T0);
    await db.query('UPDATE circle_members SET left_at = $3 WHERE circle_id = $1 AND account_id = $2', [c.id, b, T0.toISOString()]);
    expect(await joinCircle(db, b, c.id, 'Bea again', true, T0)).toEqual({ status: 'joined', slug: c.slug });
    expect((await members(c.id)).filter((m) => m.account_id === b)).toEqual([
      { account_id: b, display_name: 'Bea again', role: 'member', left_at: null },
    ]);
  });

  it('two concurrent joins of the last place leave the circle at its limit', async () => {
    const owner = await account();
    const c = await circle(owner);
    for (let i = 2; i < LIMITS.members; i++) {
      await db.query("INSERT INTO circle_members (circle_id, account_id, display_name) VALUES ($1, $2, 'M')", [c.id, await account()]);
    }
    const [x, y] = [await account(), await account()];
    const r = await Promise.all([joinCircle(db, x, c.id, 'X', true, T0), joinCircle(db, y, c.id, 'Y', true, T0)]);
    expect(r.map((s) => s.status).sort()).toEqual(['full', 'joined']);
    expect((await members(c.id)).length).toBe(LIMITS.members);
  });

  describe('communities', () => {
    it('lists open, visible communities newest first with name, slug, description and member count only', async () => {
      const owner = await account();
      const slugs: string[] = [];
      for (const [i, name] of ['Old', 'Mid', 'New'].entries()) {
        const r = await createCircle(db, owner, { name, kind: 'community', description: `About ${name}`, yourName: 'Host' }, T0);
        if (r.status !== 'created') throw new Error('create failed');
        await db.query('UPDATE circles SET created_at = $2 WHERE slug = $1', [r.slug, new Date(T0.getTime() + i * 1000).toISOString()]);
        slugs.push(r.slug);
      }
      await circle(owner, 'friends');
      await db.query("UPDATE circles SET hidden_at = now() WHERE slug = $1", [slugs[1]]);
      const list = await listCommunities(db, 1);
      expect(list).toEqual([
        { name: 'New', slug: slugs[2], description: 'About New', memberCount: 1 },
        { name: 'Old', slug: slugs[0], description: 'About Old', memberCount: 1 },
      ]);
      expect(await listCommunities(db, 2)).toEqual([]);
      expect(JSON.stringify(list)).not.toContain('Host');
    });

    it('pages by COMMUNITY_PAGE', async () => {
      for (let i = 0; i <= COMMUNITY_PAGE; i++) {
        await createCircle(db, await account(), { name: `C${i}`, kind: 'community', yourName: 'Host' }, T0);
      }
      expect(await listCommunities(db, 1)).toHaveLength(COMMUNITY_PAGE);
      expect(await listCommunities(db, 2)).toHaveLength(1);
    });

    it('joinCommunity: 16 and over join; 13-15 refused; a friends circle needs an invite; unknown is closed', async () => {
      const owner = await account();
      const r = await createCircle(db, owner, { name: 'Open', kind: 'community', yourName: 'Host' }, T0);
      if (r.status !== 'created') throw new Error('create failed');
      expect(await joinCommunity(db, await account('2010-01-01'), r.slug, 'Sixteen', T0)).toEqual({ status: 'joined', slug: r.slug });
      expect(await joinCommunity(db, await account('2012-01-01', 'confirmed'), r.slug, 'Young', T0)).toEqual({
        status: 'community_age',
      });
      const friends = await circle(owner);
      expect(await joinCommunity(db, await account(), friends.slug, 'Pat', T0)).toEqual({ status: 'invite_only' });
      expect(await joinCommunity(db, await account(), 'zzzzzzzzzz', 'Pat', T0)).toEqual({ status: 'closed' });
      expect(await joinCommunity(db, await account(), r.slug, '', T0)).toEqual({ status: 'name' });
    });
  });
});
