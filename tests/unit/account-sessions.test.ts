// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { requestAccountLink, consumeAccountLink, getAccount, endAccountSession } from '@/lib/accounts/sessions';
import { requestLink, consumeLink, getAdmin } from '@/lib/admin/sessions';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const env = {};
const ADULT = 'adult@example.test';
const TEEN = 'teen@example.test';

beforeAll(async () => {
  db = await newTestDb();
  expect((await signUp(db, { email: ADULT, dateOfBirth: '1990-05-05' }, T0)).status).toBe('created');
  // 14 on T0, turns 15 on 2026-12-01 and 16 on 2027-12-01
  expect(
    (await signUp(db, { email: TEEN, dateOfBirth: '2011-12-01', parentEmail: 'parent@example.test' }, T0)).status,
  ).toBe('created');
});
afterAll(async () => {
  await db.close();
});

async function signIn(email: string, at: Date): Promise<string> {
  const link = (await requestAccountLink(db, email, env, at))!;
  return (await consumeAccountLink(db, link, at))!;
}

describe('account sign-in links', () => {
  it('gives a token for a known address (any case) and null with zero rows for an unknown one', async () => {
    expect(await requestAccountLink(db, '  ADULT@Example.test ', env, T0)).toMatch(/^[0-9a-f]{64}$/);
    expect(await requestAccountLink(db, 'nobody@example.test', env, T0)).toBeNull();
    const r = await db.query("SELECT count(*)::int AS n FROM account_login_tokens WHERE email = 'nobody@example.test'");
    expect(r.rows[0]).toEqual({ n: 0 });
  });

  it('works once, and not after 15 minutes', async () => {
    const a = (await requestAccountLink(db, ADULT, env, T0))!;
    expect(await consumeAccountLink(db, a, plus(T0, MIN))).toMatch(/^[0-9a-f]{64}$/);
    expect(await consumeAccountLink(db, a, plus(T0, MIN))).toBeNull();
    const b = (await requestAccountLink(db, ADULT, env, T0))!;
    expect(await consumeAccountLink(db, b, plus(T0, 15 * MIN + 1000))).toBeNull();
  });

  it('refuses tampered, wrong-length and non-string tokens', async () => {
    const a = (await requestAccountLink(db, ADULT, env, T0))!;
    expect(await consumeAccountLink(db, a.slice(1), T0)).toBeNull();
    expect(await consumeAccountLink(db, a.toUpperCase(), T0)).toBeNull();
    expect(await consumeAccountLink(db, `${a}0`, T0)).toBeNull();
    expect(await consumeAccountLink(db, 'not-a-token', T0)).toBeNull();
    expect(await consumeAccountLink(db, undefined as unknown as string, T0)).toBeNull();
  });

  it('stores only hashes of tokens', async () => {
    const link = (await requestAccountLink(db, ADULT, env, T0))!;
    const session = (await consumeAccountLink(db, link, T0))!;
    const dump = JSON.stringify([
      (await db.query('SELECT * FROM account_login_tokens')).rows,
      (await db.query('SELECT * FROM account_sessions')).rows,
    ]);
    expect(dump).not.toContain(link);
    expect(dump).not.toContain(session);
  });
});

describe('account sessions', () => {
  it('identify the account; junk and unknown tokens are nobody', async () => {
    const s = await signIn(ADULT, T0);
    const me = await getAccount(db, s, T0);
    expect(me).toMatchObject({ email: ADULT, ageGroup: 'adult', consent: 'none' });
    expect(me!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getAccount(db, '', T0)).toBeNull();
    expect(await getAccount(db, 'x'.repeat(64), T0)).toBeNull();
    expect(await getAccount(db, 'junk', T0)).toBeNull();
  });

  it('last 30 days idle-refreshing, capped at 90 days from creation', async () => {
    const at = plus(T0, 100 * MIN);
    const s = await signIn(ADULT, at);
    expect(await getAccount(db, s, plus(at, 29 * DAY))).not.toBeNull();
    expect(await getAccount(db, s, plus(at, 58 * DAY))).not.toBeNull();
    expect(await getAccount(db, s, plus(at, 87 * DAY))).not.toBeNull();
    expect(await getAccount(db, s, plus(at, 91 * DAY))).toBeNull();
    const idle = await signIn(ADULT, at);
    expect(await getAccount(db, idle, plus(at, 31 * DAY))).toBeNull();
  });

  it('end on sign-out, which deletes the row', async () => {
    const s = await signIn(ADULT, T0);
    const before = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM account_sessions')).rows[0].n;
    await endAccountSession(db, s);
    expect(await getAccount(db, s, T0)).toBeNull();
    const after = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM account_sessions')).rows[0].n;
    expect(after).toBe(before - 1);
  });

  it('re-derive the age group from the stored date on every call', async () => {
    const s = await signIn(TEEN, T0);
    expect(await getAccount(db, s, T0)).toMatchObject({ ageGroup: 'teen_13_15', consent: 'pending' });
    // 2011-12-01 + 16 years: the same session now reads as 16-17 (session is within its 90-day cap only if
    // refreshed, so use a fresh sign-in at that clock)
    const later = new Date('2027-12-02T00:00:00Z');
    const s2 = await signIn(TEEN, later);
    expect(await getAccount(db, s2, later)).toMatchObject({ ageGroup: 'teen_16_17' });
  });

  it('re-derives on a live session when the birthday passes during its life', async () => {
    // 15 until 2026-12-15, then 16
    const r = await signUp(db, { email: 'edge@example.test', dateOfBirth: '2010-12-15', parentEmail: 'p2@example.test' }, T0);
    expect(r.status).toBe('created');
    const start = new Date('2026-12-01T00:00:00Z');
    const s = await signIn('edge@example.test', start);
    expect(await getAccount(db, s, plus(start, 5 * DAY))).toMatchObject({ ageGroup: 'teen_13_15' });
    expect(await getAccount(db, s, plus(start, 20 * DAY))).toMatchObject({ ageGroup: 'teen_16_17' });
  });

  it('fail closed when the group is under 13 or the date is unusable', async () => {
    const s = await signIn(TEEN, T0);
    expect(await getAccount(db, s, new Date('2023-06-01T00:00:00Z'))).toBeNull(); // 11: under 13
    expect(await getAccount(db, s, new Date('2005-01-01T00:00:00Z'))).toBeNull(); // before birth: null group
  });
});

describe('account and admin sessions are separate', () => {
  const both = { ADMIN_EMAILS: ADULT };

  it('an account session token is not an admin, even for an allow-listed address', async () => {
    const s = await signIn(ADULT, T0);
    expect(await getAccount(db, s, T0)).not.toBeNull();
    expect(await getAdmin(db, s, both, T0)).toBeNull();
  });

  it('an admin session token is not an account', async () => {
    const link = (await requestLink(db, ADULT, both, T0))!;
    const adminSession = (await consumeLink(db, link, both, T0))!;
    expect(await getAccount(db, adminSession, T0)).toBeNull();
    const link2 = (await requestLink(db, ADULT, both, T0))!;
    expect(await consumeAccountLink(db, link2, T0)).toBeNull(); // an admin link is not an account link
  });
});
