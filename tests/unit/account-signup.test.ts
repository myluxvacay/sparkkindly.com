// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-03T12:00:00Z');
const ADULT = '1990-05-05';
const TEEN14 = '2012-06-01'; // 14
const TEEN16 = '2010-01-01'; // 16
const KID = '2020-01-01'; // 6

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

const rows = async () => (await db.query<Record<string, unknown>>('SELECT * FROM accounts ORDER BY created_at, email')).rows;

describe('migration 007', () => {
  it('states a rollback in its header and creates the three tables', async () => {
    const sql = readFileSync('db/migrations/007_accounts.sql', 'utf8');
    expect(sql).toContain('Rollback');
    expect(sql).toContain('DROP TABLE account_sessions, account_login_tokens, accounts');
    for (const t of ['accounts', 'account_login_tokens', 'account_sessions']) {
      const r = await db.query("SELECT to_regclass($1) AS t", [t]);
      expect(r.rows[0]).toEqual({ t });
    }
  });

  it('indexes account_login_tokens by email (sign-up revoke and purge filter on it)', async () => {
    const r = await db.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'account_login_tokens_email_idx'");
    expect(r.rows).toEqual([{ indexdef: expect.stringMatching(/ON public\.account_login_tokens USING btree \(email\)/) }]);
  });
});

describe('signUp', () => {
  it('under 13 writes nothing and reports under_13', async () => {
    const before = (await rows()).length;
    expect(await signUp(db, { email: 'kid@example.test', dateOfBirth: KID, parentEmail: 'p@example.test' }, NOW)).toEqual({
      status: 'under_13',
    });
    expect((await rows()).length).toBe(before);
  });

  it('rejects an invalid email, an unparsable or future date, and non-string input', async () => {
    for (const input of [
      { email: 'nope', dateOfBirth: ADULT },
      { email: 'a@b', dateOfBirth: ADULT },
      { email: 'ok@example.test', dateOfBirth: '2099-01-01' },
      { email: 'ok@example.test', dateOfBirth: 'yesterday' },
      { email: 42, dateOfBirth: ADULT },
      { email: 'ok@example.test', dateOfBirth: null },
    ]) {
      expect(await signUp(db, input, NOW)).toEqual({ status: 'invalid' });
    }
    expect((await rows()).filter((r) => r.email === 'ok@example.test')).toHaveLength(0);
  });

  it('accepts only ASCII addresses: non-ASCII, final sigma and Unicode lookalikes are invalid, write nothing, never throw', async () => {
    const before = (await rows()).length;
    for (const email of [
      'josé@example.test',
      'ΟΔΟΣ@example.test', // final sigma: JS and Postgres lower-casing can disagree
      'ὈΔΥΣΣΕΎΣ@example.test',
      'adminK@example.test', // Kelvin sign, lower-cases to an ASCII k in JS
      'user@exаmple.test', // Cyrillic a
      'a b@example.test',
      'a@b@example.test',
      `${'a'.repeat(250)}@x.test`,
    ]) {
      await expect(signUp(db, { email, dateOfBirth: ADULT }, NOW), email).resolves.toEqual({ status: 'invalid' });
    }
    await expect(
      signUp(db, { email: 'ascii@example.test', dateOfBirth: TEEN14, parentEmail: 'pärent@example.test' }, NOW),
    ).resolves.toEqual({ status: 'parent_required' });
    expect((await rows()).length).toBe(before);
  });

  it('a database CHECK violation is invalid, not a thrown error; other errors still throw', async () => {
    const failing = (code: string) =>
      ({ ...db, transaction: async () => Promise.reject(Object.assign(new Error('violates check'), { code })) }) as typeof db;
    await expect(signUp(failing('23514'), { email: 'c@example.test', dateOfBirth: ADULT }, NOW)).resolves.toEqual({
      status: 'invalid',
    });
    await expect(signUp(failing('57P01'), { email: 'c@example.test', dateOfBirth: ADULT }, NOW)).rejects.toThrow();
  });

  it('13 to 15 needs a parent email different from their own', async () => {
    const own = 'teen@example.test';
    expect(await signUp(db, { email: own, dateOfBirth: TEEN14 }, NOW)).toEqual({ status: 'parent_required' });
    expect(await signUp(db, { email: own, dateOfBirth: TEEN14, parentEmail: ' TEEN@example.test ' }, NOW)).toEqual({
      status: 'parent_required',
    });
    expect(await signUp(db, { email: own, dateOfBirth: TEEN14, parentEmail: 'bad' }, NOW)).toEqual({ status: 'parent_required' });
    expect((await rows()).filter((r) => r.email === own)).toHaveLength(0);

    const r = await signUp(db, { email: own, dateOfBirth: TEEN14, parentEmail: ' Parent@Example.test ' }, NOW);
    expect(r.status).toBe('created');
    const row = (await rows()).find((x) => x.email === own)!;
    expect(row.consent_state).toBe('pending');
    expect(row.parent_email).toBe('parent@example.test');
  });

  it('16 and over store consent none and no parent email', async () => {
    for (const [email, dob] of [
      ['sixteen@example.test', TEEN16],
      ['adult@example.test', ADULT],
    ]) {
      expect((await signUp(db, { email, dateOfBirth: dob, parentEmail: 'p@example.test' }, NOW)).status).toBe('created');
      const row = (await rows()).find((x) => x.email === email)!;
      expect(row.consent_state).toBe('none');
      expect(row.parent_email).toBeNull();
      expect(row).not.toHaveProperty('age_group');
    }
  });

  it('lower-cases and trims the email; a duplicate (any case) is exists and adds no row', async () => {
    const a = await signUp(db, { email: '  Dupe@Example.TEST ', dateOfBirth: ADULT }, NOW);
    expect(a.status).toBe('created');
    expect((await rows()).some((x) => x.email === 'dupe@example.test')).toBe(true);
    const n = (await rows()).length;
    await db.query("UPDATE accounts SET verified_at = now() WHERE email = 'dupe@example.test'");
    expect(await signUp(db, { email: 'DUPE@example.test', dateOfBirth: ADULT }, NOW)).toEqual({ status: 'exists' });
    expect((await rows()).length).toBe(n);
  });

  it('time zone: a known zone or UTC is kept; unknown or missing becomes UTC', async () => {
    const tz = async (email: string, timeZone: unknown) => {
      await signUp(db, { email, dateOfBirth: ADULT, timeZone }, NOW);
      return (await rows()).find((x) => x.email === email)!.time_zone;
    };
    expect(await tz('tz1@example.test', 'Europe/London')).toBe('Europe/London');
    expect(await tz('tz2@example.test', 'UTC')).toBe('UTC');
    expect(await tz('tz3@example.test', 'Mars/Olympus')).toBe('UTC');
    expect(await tz('tz4@example.test', undefined)).toBe('UTC');
    expect(await tz('tz5@example.test', 7)).toBe('UTC');
  });
});
