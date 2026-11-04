// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { requestAccountLink, consumeAccountLink } from '@/lib/accounts/sessions';
import { issueConsentTokens, consentTarget, confirmConsent, withdrawConsent } from '@/lib/accounts/consent';
import { deleteAccount } from '@/lib/accounts/delete';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const DAY = 24 * 60 * 60_000;
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const PARENT = 'parent@example.test';
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM account_login_tokens');
});

// A 14-year-old with a parent address; verified by default.
async function teen(verified = true): Promise<{ id: string; email: string }> {
  const email = `teen${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth: '2011-12-01', parentEmail: PARENT }, T0);
  if (r.status !== 'created') {
    throw new Error('sign-up failed');
  }
  if (verified) {
    await db.query('UPDATE accounts SET verified_at = $2 WHERE id = $1', [r.accountId, T0.toISOString()]);
  }
  return { id: r.accountId, email };
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query<{ n: number }>(sql, params);
  return r.rows[0].n;
}

describe('issueConsentTokens', () => {
  it('is null for unverified, none and already confirmed accounts', async () => {
    const u = await teen(false);
    expect(await issueConsentTokens(db, u.id, T0)).toBeNull();
    const adult = await signUp(db, { email: 'adult@example.test', dateOfBirth: '1990-05-05' }, T0);
    if (adult.status !== 'created') {
      throw new Error('sign-up failed');
    }
    await db.query('UPDATE accounts SET verified_at = now() WHERE id = $1', [adult.accountId]);
    expect(await issueConsentTokens(db, adult.accountId, T0)).toBeNull();
    const v = await teen();
    const t = (await issueConsentTokens(db, v.id, T0))!;
    expect(t.parentEmail).toBe(PARENT);
    expect(await confirmConsent(db, t.confirm, T0)).toBe('confirmed');
    expect(await issueConsentTokens(db, v.id, T0)).toBeNull();
  });

  it('stores only hashes', async () => {
    const u = await teen();
    const t = (await issueConsentTokens(db, u.id, T0))!;
    const dump = JSON.stringify((await db.query('SELECT * FROM account_consent_tokens')).rows);
    expect(dump).not.toContain(t.confirm);
    expect(dump).not.toContain(t.withdraw);
  });

  it('a second issue revokes the old confirm token but the old withdraw token still works', async () => {
    const u = await teen();
    const a = (await issueConsentTokens(db, u.id, T0))!;
    const b = (await issueConsentTokens(db, u.id, T0))!;
    expect(await confirmConsent(db, a.confirm, T0)).toBe('invalid');
    expect(await consentTarget(db, a.withdraw, 'withdraw', T0)).toMatchObject({
      accountId: u.id,
    });
    expect(await confirmConsent(db, b.confirm, T0)).toBe('confirmed');
  });
});

describe('confirmConsent', () => {
  it('confirms, records consent_at, and a reuse is invalid', async () => {
    const u = await teen();
    const t = (await issueConsentTokens(db, u.id, T0))!;
    const at = plus(T0, DAY);
    expect(await confirmConsent(db, t.confirm, at)).toBe('confirmed');
    const r = await db.query<{ consent_state: string; consent_at: Date }>(
      'SELECT consent_state, consent_at FROM accounts WHERE id = $1',
      [u.id],
    );
    expect(r.rows[0].consent_state).toBe('confirmed');
    expect(new Date(r.rows[0].consent_at).toISOString()).toBe(at.toISOString());
    expect(await confirmConsent(db, t.confirm, at)).toBe('invalid');
  });

  it('is invalid after 30 days', async () => {
    const u = await teen();
    const t = (await issueConsentTokens(db, u.id, T0))!;
    expect(await confirmConsent(db, t.confirm, plus(T0, 31 * DAY))).toBe('invalid');
  });

  it('a confirm token is not a withdraw token and vice versa', async () => {
    const u = await teen();
    const t = (await issueConsentTokens(db, u.id, T0))!;
    expect(await consentTarget(db, t.confirm, 'withdraw', T0)).toBeNull();
    expect(await withdrawConsent(db, t.confirm, T0)).toBe('invalid');
    expect(await confirmConsent(db, t.withdraw, T0)).toBe('invalid');
    expect(await count('SELECT count(*)::int AS n FROM accounts WHERE id = $1', [u.id])).toBe(1);
  });

  it("account A's token cannot affect account B", async () => {
    const a = await teen();
    const b = await teen();
    const ta = (await issueConsentTokens(db, a.id, T0))!;
    await issueConsentTokens(db, b.id, T0);
    expect(await confirmConsent(db, ta.confirm, T0)).toBe('confirmed');
    const r = await db.query<{ consent_state: string }>('SELECT consent_state FROM accounts WHERE id = $1', [b.id]);
    expect(r.rows[0].consent_state).toBe('pending');
  });

  it('changing parent_email invalidates outstanding tokens', async () => {
    const u = await teen();
    const t = (await issueConsentTokens(db, u.id, T0))!;
    await db.query("UPDATE accounts SET parent_email = 'other@example.test' WHERE id = $1", [u.id]);
    expect(await consentTarget(db, t.confirm, 'confirm', T0)).toBeNull();
    expect(await confirmConsent(db, t.confirm, T0)).toBe('invalid');
    expect(await withdrawConsent(db, t.withdraw, T0)).toBe('invalid');
  });

  it('a concurrent confirm cannot double-record', async () => {
    const u = await teen();
    const t = (await issueConsentTokens(db, u.id, T0))!;
    const [x, y] = await Promise.all([confirmConsent(db, t.confirm, T0), confirmConsent(db, t.confirm, plus(T0, DAY))]);
    expect([x, y].sort()).toEqual(['confirmed', 'invalid']);
  });

  it('junk tokens are invalid', async () => {
    expect(await confirmConsent(db, 'junk', T0)).toBe('invalid');
    expect(await confirmConsent(db, undefined as unknown as string, T0)).toBe('invalid');
    expect(await consentTarget(db, 'x'.repeat(64), 'confirm', T0)).toBeNull();
  });
});

describe('consentTarget', () => {
  it('masks the parent address and reports state without consuming', async () => {
    const u = await teen();
    const t = (await issueConsentTokens(db, u.id, T0))!;
    const target = await consentTarget(db, t.confirm, 'confirm', T0);
    expect(target).toEqual({
      accountId: u.id,
      maskedParent: 'p•••@example.test',
      state: 'pending',
    });
    expect(await consentTarget(db, t.confirm, 'confirm', T0)).not.toBeNull();
    await confirmConsent(db, t.confirm, T0);
    expect((await consentTarget(db, t.withdraw, 'withdraw', T0))!.state).toBe('confirmed');
  });
});

describe('withdrawConsent and deleteAccount', () => {
  it('leaves no rows for the account and keeps another account intact', async () => {
    const a = await teen();
    const b = await teen();
    for (const u of [a, b]) {
      const link = (await requestAccountLink(db, u.email, {}, T0))!;
      await consumeAccountLink(db, link, T0);
      await requestAccountLink(db, u.email, {}, T0);
    }
    const ta = (await issueConsentTokens(db, a.id, T0))!;
    await issueConsentTokens(db, b.id, T0);
    expect(await withdrawConsent(db, ta.withdraw, T0)).toBe('withdrawn');
    expect(await count('SELECT count(*)::int AS n FROM accounts WHERE id = $1', [a.id])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM account_sessions WHERE account_id = $1', [a.id])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM account_consent_tokens WHERE account_id = $1', [a.id])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM account_login_tokens WHERE email = $1', [a.email])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM accounts WHERE id = $1', [b.id])).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM account_sessions WHERE account_id = $1', [b.id])).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM account_consent_tokens WHERE account_id = $1', [b.id])).toBe(2);
    expect(await count('SELECT count(*)::int AS n FROM account_login_tokens WHERE email = $1', [b.email])).toBe(2);
    expect(await withdrawConsent(db, ta.withdraw, T0)).toBe('invalid');
  });

  it('deleteAccount is false for an unknown account', async () => {
    expect(await deleteAccount(db, '00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});

describe('signUp replace', () => {
  it('removes the replaced unverified account consent tokens', async () => {
    const email = 'replace@example.test';
    const first = await signUp(db, { email, dateOfBirth: '2011-12-01', parentEmail: PARENT }, T0);
    if (first.status !== 'created') {
      throw new Error('sign-up failed');
    }
    // Tokens are only issued to verified accounts; insert one directly to model a leftover.
    await db.query(
      "INSERT INTO account_consent_tokens (token_hash, account_id, parent_email, purpose) VALUES ('h1', $1, $2, 'withdraw')",
      [first.accountId, PARENT],
    );
    await signUp(db, { email, dateOfBirth: '2011-12-01', parentEmail: PARENT }, plus(T0, DAY));
    expect(await count('SELECT count(*)::int AS n FROM account_consent_tokens')).toBe(0);
  });
});
