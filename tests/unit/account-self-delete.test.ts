// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { issueConsentTokens } from '@/lib/accounts/consent';
import { createChildProfile } from '@/lib/accounts/children';
import { setInterests } from '@/lib/accounts/interests';
import { recordAnswer } from '@/lib/accounts/responses';
import { deleteOwnAccount } from '@/lib/accounts/self-delete';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
let itemId = '';
let worldId = 0;
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  worldId = (await db.query<{ id: number }>('SELECT id FROM worlds ORDER BY id LIMIT 1')).rows[0].id;
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     VALUES ($1,'quiz','del-one','T','S','{}'::jsonb,'all','published','2026-10-31T00:00:00Z','test','computable','test') RETURNING id`,
    [worldId],
  );
  itemId = r.rows[0].id;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM account_login_tokens');
});

const TABLES = [
  'accounts',
  'account_login_tokens',
  'account_sessions',
  'account_consent_tokens',
  'child_profiles',
  'profile_interests',
  'item_responses',
];
async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    out[t] = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
  }
  return out;
}

// A 13-15 account (so it has consent tokens) with a session, a used and an unused sign-in link, a child profile... a
// 13-15 account cannot hold child profiles, so the profile, interests and answers are on an adult account instead.
async function fullTeen(email: string): Promise<string> {
  const r = await signUp(db, { email, dateOfBirth: '2012-01-01', parentEmail: `p-${email}` }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const link = await requestAccountLink(db, email, {}, T0);
  await consumeAccountLink(db, link as string, T0);
  await requestAccountLink(db, email, {}, new Date(T0.getTime() + 120_000));
  await issueConsentTokens(db, r.accountId, T0);
  return r.accountId;
}
async function fullAdult(email: string): Promise<string> {
  const r = await signUp(db, { email, dateOfBirth: '1990-05-05' }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const link = await requestAccountLink(db, email, {}, T0);
  await consumeAccountLink(db, link as string, T0);
  await requestAccountLink(db, email, {}, new Date(T0.getTime() + 120_000));
  const c = await createChildProfile(
    db,
    r.accountId,
    { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: true, pin: '1234' },
    T0,
  );
  if (c.status !== 'created') throw new Error('profile failed');
  for (const profileId of [null, c.profileId]) {
    await setInterests(db, { accountId: r.accountId, profileId }, { topicIds: [], worldIds: [worldId] });
    await recordAnswer(db, { accountId: r.accountId, profileId }, itemId, true, T0);
  }
  return r.accountId;
}

describe('deleteOwnAccount', () => {
  it('a mismatched email deletes nothing', async () => {
    const id = await fullAdult(`d${n++}@example.test`);
    await fullTeen(`t${n++}@example.test`);
    const before = await counts();
    for (const typed of ['someone@example.test', '', 42, null, undefined, 'd@example']) {
      expect(await deleteOwnAccount(db, id, typed)).toBe('mismatch');
    }
    expect(await counts()).toEqual(before);
  });

  it('the matching email (any case, surrounding spaces) removes every row in all seven tables', async () => {
    // An adult (profiles, interests, answers) and a 13-15 holder (consent tokens): together they fill all seven tables.
    const email = `d${n++}@example.test`;
    const id = await fullAdult(email);
    const teenEmail = `t${n++}@example.test`;
    const teen = await fullTeen(teenEmail);
    const before = await counts();
    for (const t of TABLES) expect(before[t], t).toBeGreaterThan(0);
    expect(await deleteOwnAccount(db, id, `  ${email.toUpperCase()} `)).toBe('deleted');
    expect(await deleteOwnAccount(db, teen, teenEmail)).toBe('deleted');
    const after = await counts();
    for (const t of TABLES) expect(after[t], t).toBe(0);
  });

  it('a teen account takes its consent tokens and links with it, and another account is untouched', async () => {
    const keepEmail = `k${n++}@example.test`;
    const keep = await fullAdult(keepEmail);
    const keepBefore = await counts();
    const email = `t${n++}@example.test`;
    const id = await fullTeen(email);
    expect(await deleteOwnAccount(db, id, email)).toBe('deleted');
    expect(await counts()).toEqual(keepBefore);
    expect((await db.query('SELECT 1 FROM accounts WHERE id = $1', [keep])).rows).toHaveLength(1);
    expect((await db.query('SELECT 1 FROM account_login_tokens WHERE email = $1', [email])).rows).toHaveLength(0);
  });

  it("typing another account's email does not delete either account", async () => {
    const a = await fullAdult(`a${n++}@example.test`);
    const bEmail = `b${n++}@example.test`;
    await fullAdult(bEmail);
    const before = await counts();
    expect(await deleteOwnAccount(db, a, bEmail)).toBe('mismatch');
    expect(await counts()).toEqual(before);
  });

  it('an unknown or malformed account id is not_found', async () => {
    expect(await deleteOwnAccount(db, '00000000-0000-0000-0000-000000000001', 'x@example.test')).toBe('not_found');
    expect(await deleteOwnAccount(db, 'nope', 'x@example.test')).toBe('not_found');
  });

  it('logs nothing about the typed or stored email', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m));
    const email = `q${n++}@example.test`;
    const id = await fullAdult(email);
    await deleteOwnAccount(db, id, 'wrong@example.test');
    await deleteOwnAccount(db, id, email);
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});
