// @vitest-environment node
// Circles core (plan 4A Task 1): creation rules, listing, the member view and leaving.
import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import { circlesEnabled } from '@/lib/config';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { LIMITS, canCreateKind, validateCircleInput } from '@/lib/circles/rules';
import { createCircle, getCircleForMember, leaveCircle, listMyCircles } from '@/lib/circles/repo';

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
  await db.query('DELETE FROM circles');
  await db.query('DELETE FROM accounts');
});

async function account(dateOfBirth: string, parentEmail?: string, timeZone?: string): Promise<string> {
  const r = await signUp(db, { email: `circ${n++}@example.test`, dateOfBirth, parentEmail, timeZone }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  return r.accountId;
}
const adult = () => account('1990-05-05');
const olderTeen = () => account('2010-01-01');
async function youngTeen(confirmed: boolean) {
  const id = await account('2012-01-01', `parent${n++}@example.test`);
  if (confirmed) await db.query("UPDATE accounts SET consent_state = 'confirmed' WHERE id = $1", [id]);
  return id;
}
const input = (over: Record<string, unknown> = {}) => ({ name: 'The Quizzers', kind: 'friends', yourName: 'Sam', ...over });
async function make(accountId: string, over: Record<string, unknown> = {}) {
  const r = await createCircle(db, accountId, input(over), T0);
  if (r.status !== 'created') throw new Error(`create failed: ${r.status}`);
  return r.slug;
}
// A member row added directly (joining arrives in 4B).
async function addMember(slug: string, accountId: string, name = 'Pat') {
  await db.query(
    `INSERT INTO circle_members (circle_id, account_id, display_name) SELECT id, $2, $3 FROM circles WHERE slug = $1`,
    [slug, accountId, name],
  );
}
const count = async (sql: string, p: unknown[] = []) => (await db.query<{ n: number }>(sql, p)).rows[0].n;

describe('circlesEnabled', () => {
  it('needs both ACCOUNTS_ENABLED and CIRCLES_ENABLED set to true or 1', () => {
    for (const [accounts, circles, on] of [
      ['true', 'true', true],
      ['1', '1', true],
      ['true', '', false],
      ['', 'true', false],
      ['true', 'yes', false],
      ['false', 'true', false],
    ] as const) {
      vi.stubEnv('ACCOUNTS_ENABLED', accounts);
      vi.stubEnv('CIRCLES_ENABLED', circles);
      expect(circlesEnabled(), `${accounts}/${circles}`).toBe(on);
    }
    vi.unstubAllEnvs();
  });
});

describe('validateCircleInput and canCreateKind', () => {
  it('trims and NFKC-normalises the name and keeps a community description only', () => {
    const r = validateCircleInput(input({ name: '  Ｑuiz  Crew ', kind: 'community', description: ' We play ' }), 'Europe/Paris');
    expect(r).toEqual({
      ok: true,
      value: { name: 'Quiz  Crew', kind: 'community', description: 'We play', timeZone: 'Europe/Paris', yourName: 'Sam' },
    });
    const f = validateCircleInput(input({ description: 'ignored' }));
    expect(f.ok && f.value.description).toBe(null);
    expect(f.ok && f.value.timeZone).toBe('UTC');
  });

  it('refuses bad names, kinds, zones, member names and descriptions', () => {
    for (const over of [
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(41) },
      { name: 'what the fuck' },
      { name: 42 },
      { kind: 'public' },
      { kind: undefined },
      { timeZone: 'Mars/Olympus' },
      { yourName: '' },
      { yourName: 'x'.repeat(31) },
      { yourName: 'me@example.test' },
      { yourName: 'shit' },
      { kind: 'community', description: 'x'.repeat(201) },
      { kind: 'community', description: 'bullshit club' },
    ]) {
      expect(validateCircleInput(input(over)), JSON.stringify(over)).toEqual({ ok: false });
    }
    expect(validateCircleInput(null)).toEqual({ ok: false });
    expect(validateCircleInput(input({ name: 'x'.repeat(40) })).ok).toBe(true);
  });

  it('adults create every kind; teens friends only; a pending 13-15 nothing', () => {
    for (const kind of ['friends', 'family', 'community'] as const) expect(canCreateKind('adult', 'none', kind)).toBe(true);
    expect(canCreateKind('teen_16_17', 'none', 'friends')).toBe(true);
    expect(canCreateKind('teen_13_15', 'confirmed', 'friends')).toBe(true);
    for (const kind of ['family', 'community'] as const) {
      expect(canCreateKind('teen_16_17', 'none', kind)).toBe(false);
      expect(canCreateKind('teen_13_15', 'confirmed', kind)).toBe(false);
    }
    expect(canCreateKind('teen_13_15', 'pending', 'friends')).toBe(false);
    expect(canCreateKind('under_13', 'none', 'friends')).toBe(false);
  });
});

describe('createCircle', () => {
  it('creates a friends circle for an adult, a 16-year-old and a confirmed 13-15', async () => {
    for (const id of [await adult(), await olderTeen(), await youngTeen(true)]) {
      expect((await createCircle(db, id, input(), T0)).status).toBe('created');
    }
    expect(await count('SELECT count(*)::int AS n FROM circles')).toBe(3);
  });

  it('a pending 13-15, an unknown or malformed account is not allowed; teens cannot create family or community', async () => {
    expect(await createCircle(db, await youngTeen(false), input(), T0)).toEqual({ status: 'not_allowed' });
    expect(await createCircle(db, '00000000-0000-0000-0000-000000000000', input(), T0)).toEqual({ status: 'not_allowed' });
    expect(await createCircle(db, 'nope', input(), T0)).toEqual({ status: 'not_allowed' });
    for (const id of [await olderTeen(), await youngTeen(true)]) {
      for (const kind of ['family', 'community']) {
        expect(await createCircle(db, id, input({ kind }), T0)).toEqual({ status: 'not_allowed' });
      }
    }
    expect(await count('SELECT count(*)::int AS n FROM circles')).toBe(0);
  });

  it('invalid input writes nothing', async () => {
    const id = await adult();
    for (const name of ['', '   ', 'x'.repeat(41), 'fuck it']) {
      expect(await createCircle(db, id, input({ name }), T0)).toEqual({ status: 'invalid' });
    }
    expect(await count('SELECT count(*)::int AS n FROM circles')).toBe(0);
  });

  it('the owner is a member with role owner and the name they typed; the zone defaults to the account', async () => {
    const id = await account('1990-05-05', undefined, 'Europe/Paris');
    const slug = await make(id, { yourName: ' Mum ' });
    const m = await db.query(
      `SELECT m.role, m.display_name, m.profile_id, c.owner_account_id, c.time_zone, c.status
       FROM circle_members m JOIN circles c ON c.id = m.circle_id WHERE c.slug = $1`,
      [slug],
    );
    expect(m.rows).toEqual([
      { role: 'owner', display_name: 'Mum', profile_id: null, owner_account_id: id, time_zone: 'Europe/Paris', status: 'open' },
    ]);
  });

  it('slugs are 10 random lowercase alphanumerics, different per circle and never from the name', async () => {
    const id = await adult();
    const a = await make(id);
    const b = await make(id);
    for (const s of [a, b]) expect(s).toMatch(/^[a-z0-9]{10}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('quiz');
  });

  it(`an account owns at most ${LIMITS.ownedOpen} open circles; a closed one frees a place`, async () => {
    const id = await adult();
    const slugs = [];
    for (let i = 0; i < LIMITS.ownedOpen; i++) slugs.push(await make(id));
    expect(await createCircle(db, id, input(), T0)).toEqual({ status: 'limit' });
    await db.query("UPDATE circles SET status = 'closed', closed_at = $2 WHERE slug = $1", [slugs[0], T0.toISOString()]);
    expect((await createCircle(db, id, input(), T0)).status).toBe('created');
  });

  it(`an account belongs to at most ${LIMITS.memberOf} circles`, async () => {
    const id = await adult();
    const others = [await adult(), await adult()];
    for (let i = 0; i < LIMITS.memberOf; i++) await addMember(await make(others[i % 2]), id);
    expect(await createCircle(db, id, input(), T0)).toEqual({ status: 'limit' });
  });
});

describe('listMyCircles and getCircleForMember', () => {
  it("lists only the account's own open circles, with current member counts", async () => {
    const a = await adult();
    const b = await adult();
    const mine = await make(a, { name: 'Mine' });
    await make(b, { name: 'Theirs' });
    await addMember(mine, b, 'Bea');
    const closed = await make(a, { name: 'Old' });
    await db.query("UPDATE circles SET status = 'closed', closed_at = $2 WHERE slug = $1", [closed, T0.toISOString()]);
    expect(await listMyCircles(db, a)).toEqual([{ slug: mine, name: 'Mine', kind: 'friends', role: 'owner', memberCount: 2 }]);
    expect((await listMyCircles(db, b)).map((c) => c.name).sort()).toEqual(['Mine', 'Theirs']);
    expect(await listMyCircles(db, 'nope')).toEqual([]);
  });

  it('a member sees names and roles, never an email; null for a non-member, a left member and a hidden circle', async () => {
    const a = await adult();
    const b = await adult();
    const stranger = await adult();
    const slug = await make(a, { yourName: 'Alex' });
    await addMember(slug, b, 'Bea');
    const v = await getCircleForMember(db, b, slug);
    expect(v).toMatchObject({ slug, name: 'The Quizzers', kind: 'friends', status: 'open', myRole: 'member' });
    expect(v!.members.map((m) => [m.name, m.role, m.isYou])).toEqual([
      ['Alex', 'owner', false],
      ['Bea', 'member', true],
    ]);
    const text = JSON.stringify(v);
    expect(text).not.toContain('@');
    expect(text.toLowerCase()).not.toContain('email');
    expect(await getCircleForMember(db, stranger, slug)).toBeNull();
    expect(await getCircleForMember(db, a, 'zzzzzzzzzz')).toBeNull();
    expect(await getCircleForMember(db, 'nope', slug)).toBeNull();
    await db.query('UPDATE circle_members SET left_at = $2 WHERE account_id = $1', [b, T0.toISOString()]);
    expect(await getCircleForMember(db, b, slug)).toBeNull();
    await db.query('UPDATE circles SET hidden_at = $2 WHERE slug = $1', [slug, T0.toISOString()]);
    expect(await getCircleForMember(db, a, slug)).toBeNull();
  });
});

describe('leaveCircle', () => {
  it('a member leaves (the row keeps left_at); the owner must transfer first; a stranger is not a member', async () => {
    const a = await adult();
    const b = await adult();
    const slug = await make(a);
    await addMember(slug, b);
    expect(await leaveCircle(db, a, slug, T0)).toBe('owner_must_transfer');
    expect(await leaveCircle(db, await adult(), slug, T0)).toBe('not_member');
    expect(await leaveCircle(db, b, 'zzzzzzzzzz', T0)).toBe('not_member');
    expect(await leaveCircle(db, b, slug, T0)).toBe('left');
    expect(await count('SELECT count(*)::int AS n FROM circle_members WHERE account_id = $1 AND left_at IS NOT NULL', [b])).toBe(1);
    expect(await leaveCircle(db, b, slug, T0)).toBe('not_member');
    expect(await listMyCircles(db, b)).toEqual([]);
    expect(await getCircleForMember(db, b, slug)).toBeNull();
    expect((await listMyCircles(db, a))[0].memberCount).toBe(1);
  });

  it("leaving removes the account's child profiles from that circle too", async () => {
    const a = await adult();
    const b = await adult();
    const slug = await make(a, { kind: 'family' });
    await addMember(slug, b);
    const p = await db.query<{ id: string }>(
      "INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, 'Mia', '6-9') RETURNING id",
      [b],
    );
    await db.query(
      "INSERT INTO circle_members (circle_id, account_id, profile_id, display_name) SELECT id, $2, $3, 'Mia' FROM circles WHERE slug = $1",
      [slug, b, p.rows[0].id],
    );
    expect(await leaveCircle(db, b, slug, T0)).toBe('left');
    expect(await count('SELECT count(*)::int AS n FROM circle_members WHERE account_id = $1 AND left_at IS NULL', [b])).toBe(0);
  });
});
