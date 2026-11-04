// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, linkTarget, requestAccountLink } from '@/lib/accounts/sessions';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-03T12:00:00Z');
const row = async (email: string) =>
  (
    await db.query<Record<string, unknown>>(
      "SELECT *, to_char(date_of_birth, 'YYYY-MM-DD') AS dob FROM accounts WHERE email = $1",
      [email],
    )
  ).rows[0];

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

describe('sign-up squatting', () => {
  it('a sign-up for an unverified address replaces dob, parent, consent and zone (latest wins)', async () => {
    const e = 'victim@example.test';
    const first = await signUp(
      db,
      { email: e, dateOfBirth: '2011-12-01', parentEmail: 'evil@example.test', timeZone: 'Asia/Tokyo' },
      NOW,
    );
    expect(first.status).toBe('created');
    const second = await signUp(db, { email: e, dateOfBirth: '1990-05-05', timeZone: 'Europe/London' }, NOW);
    expect(second.status).toBe('created');
    const r = await row(e);
    expect([r.dob, r.parent_email, r.consent_state, r.time_zone]).toEqual(['1990-05-05', null, 'none', 'Europe/London']);
  });

  it('under 13 changes nothing, even over an unverified row', async () => {
    const e = 'victim2@example.test';
    await signUp(db, { email: e, dateOfBirth: '1990-05-05' }, NOW);
    expect(await signUp(db, { email: e, dateOfBirth: '2020-01-01' }, NOW)).toEqual({ status: 'under_13' });
    expect((await row(e)).dob).toBe('1990-05-05');
  });

  it('using a link verifies the account, once; after that a sign-up never changes it', async () => {
    const e = 'real@example.test';
    await signUp(db, { email: e, dateOfBirth: '1990-05-05' }, NOW);
    expect((await row(e)).verified_at).toBeNull();
    const t1 = (await requestAccountLink(db, e, {}, NOW))!;
    expect(await consumeAccountLink(db, t1, NOW)).not.toBeNull();
    const first = (await row(e)).verified_at as Date;
    expect(first).not.toBeNull();
    const later = new Date(NOW.getTime() + 3600_000);
    const t2 = (await requestAccountLink(db, e, {}, later))!;
    await consumeAccountLink(db, t2, later);
    expect(+((await row(e)).verified_at as Date)).toBe(+first);
    expect(await signUp(db, { email: e, dateOfBirth: '2005-01-01', timeZone: 'Asia/Tokyo' }, NOW)).toEqual({
      status: 'exists',
    });
    const r = await row(e);
    expect([r.dob, r.time_zone]).toEqual(['1990-05-05', 'UTC']);
  });

  it('the new CHECKs refuse an untrimmed email, a parent on a no-consent row and a parent equal to the email', async () => {
    const ins = (email: string, consent: string, parent: string | null) =>
      db.query('INSERT INTO accounts (email, date_of_birth, consent_state, parent_email) VALUES ($1, $2, $3, $4)', [
        email,
        '2000-01-01',
        consent,
        parent,
      ]);
    await expect(ins(' pad@example.test', 'none', null)).rejects.toThrow();
    await expect(ins('p1@example.test', 'none', 'p@example.test')).rejects.toThrow();
    await expect(ins('p2@example.test', 'pending', 'p2@example.test')).rejects.toThrow();
  });
});

describe('linkTarget', () => {
  it('shows the address for a valid unused link without using it; nothing for used, expired or junk', async () => {
    const e = 'target@example.test';
    await signUp(db, { email: e, dateOfBirth: '1990-05-05' }, NOW);
    const t = (await requestAccountLink(db, e, {}, NOW))!;
    expect(await linkTarget(db, t, NOW)).toBe(e);
    expect(await linkTarget(db, t, NOW)).toBe(e);
    expect(await linkTarget(db, t, new Date(NOW.getTime() + 16 * 60_000))).toBeNull();
    await consumeAccountLink(db, t, NOW);
    expect(await linkTarget(db, t, NOW)).toBeNull();
    expect(await linkTarget(db, 'junk', NOW)).toBeNull();
    expect(await linkTarget(db, 'a'.repeat(64), NOW)).toBeNull();
  });
});
