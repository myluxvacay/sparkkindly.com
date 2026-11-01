// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { newTotpSecret, totpAt } from '@/lib/admin/totp';
import {
  allowList,
  isAllowed,
  requestLink,
  consumeLink,
  submitCode,
  getAdmin,
  pendingEmail,
  endSession,
  csrfToken,
  checkCsrf,
} from '@/lib/admin/sessions';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const OWNER = 'owner@example.test';
const env = { ADMIN_EMAILS: ' Owner@Example.test , second@example.test,,' };
const T0 = new Date('2026-11-01T08:00:00Z');
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const MIN = 60_000;
const stepOf = (d: Date) => Math.floor(d.getTime() / 30_000);
let secret: string;

beforeAll(async () => {
  db = await newTestDb();
  secret = newTotpSecret();
  await db.query('INSERT INTO admin_users (email, totp_secret) VALUES ($1, $2)', [OWNER, secret]);
});
afterAll(async () => {
  await db.close();
});

// Signs in fully at `at` with the code for that moment.
async function signIn(at: Date): Promise<string> {
  const link = (await requestLink(db, OWNER, env, at))!;
  const session = (await consumeLink(db, link, env, at))!;
  expect(await submitCode(db, session, totpAt(secret, stepOf(at)), env, at)).toBe('ok');
  return session;
}

describe('allow-list', () => {
  it('is read from ADMIN_EMAILS, trimmed and lower-cased; an unset or empty value allows nobody', () => {
    expect(allowList(env)).toEqual([OWNER, 'second@example.test']);
    expect(isAllowed('OWNER@example.test', env)).toBe(true);
    expect(isAllowed('someone@example.test', env)).toBe(false);
    expect(allowList({})).toEqual([]);
    expect(isAllowed('', { ADMIN_EMAILS: '' })).toBe(false);
  });
});

describe('sign-in links', () => {
  it('gives no token and writes no row for an address not on the allow-list', async () => {
    expect(await requestLink(db, 'intruder@example.test', env, T0)).toBeNull();
    const r = await db.query("SELECT count(*)::int AS n FROM admin_login_tokens WHERE email = 'intruder@example.test'");
    expect(r.rows[0]).toEqual({ n: 0 });
  });

  it('works once, and not after 15 minutes', async () => {
    const a = (await requestLink(db, OWNER, env, T0))!;
    expect(await consumeLink(db, a, env, plus(T0, MIN))).toMatch(/^[0-9a-f]{64}$/);
    expect(await consumeLink(db, a, env, plus(T0, MIN))).toBeNull();
    const b = (await requestLink(db, OWNER, env, T0))!;
    expect(await consumeLink(db, b, env, plus(T0, 15 * MIN + 1000))).toBeNull();
    expect(await consumeLink(db, 'not-a-token', env, T0)).toBeNull();
  });

  it('refuses a link whose address left the allow-list before it was used', async () => {
    const a = (await requestLink(db, OWNER, env, T0))!;
    expect(await consumeLink(db, a, { ADMIN_EMAILS: 'second@example.test' }, T0)).toBeNull();
  });

  it('stores only hashes of tokens', async () => {
    const link = (await requestLink(db, OWNER, env, T0))!;
    const session = (await consumeLink(db, link, env, T0))!;
    const dump = JSON.stringify([
      (await db.query('SELECT * FROM admin_login_tokens')).rows,
      (await db.query('SELECT * FROM admin_sessions')).rows,
    ]);
    expect(dump).not.toContain(link);
    expect(dump).not.toContain(session);
  });
});

describe('second factor', () => {
  it('a session that used its link but not its code is not an admin', async () => {
    const link = (await requestLink(db, OWNER, env, T0))!;
    const session = (await consumeLink(db, link, env, T0))!;
    expect(await getAdmin(db, session, env, T0)).toBeNull();
    expect(await pendingEmail(db, session, T0)).toBe(OWNER);
  });

  it('a right code makes the session an admin; the same code cannot be used again', async () => {
    const at = plus(T0, 10 * MIN);
    const s = await signIn(at);
    expect(await getAdmin(db, s, env, at)).toEqual({ email: OWNER });
    expect(await pendingEmail(db, s, at)).toBeNull();
    const link = (await requestLink(db, OWNER, env, at))!;
    const other = (await consumeLink(db, link, env, at))!;
    expect(await submitCode(db, other, totpAt(secret, stepOf(at)), env, at)).toBe('bad');
  });

  it('five wrong codes lock the session and delete it', async () => {
    const at = plus(T0, 20 * MIN);
    const link = (await requestLink(db, OWNER, env, at))!;
    const s = (await consumeLink(db, link, env, at))!;
    for (let i = 0; i < 4; i++) expect(await submitCode(db, s, '000000', env, at)).toBe('bad');
    expect(await submitCode(db, s, '000000', env, at)).toBe('locked');
    expect(await submitCode(db, s, totpAt(secret, stepOf(at)), env, at)).toBe('none');
  });

  it('a code after the pending session expired is refused', async () => {
    const at = plus(T0, 30 * MIN);
    const link = (await requestLink(db, OWNER, env, at))!;
    const s = (await consumeLink(db, link, env, at))!;
    const late = plus(at, 10 * MIN + 1000);
    expect(await submitCode(db, s, totpAt(secret, stepOf(late)), env, late)).toBe('none');
  });

  it('an allow-listed address with no enrolled authenticator cannot finish', async () => {
    const link = (await requestLink(db, 'second@example.test', env, T0))!;
    const s = (await consumeLink(db, link, env, T0))!;
    expect(await submitCode(db, s, '123456', env, T0)).toBe('not_enrolled');
    expect(await getAdmin(db, s, env, T0)).toBeNull();
  });

  it('an address removed from the allow-list cannot finish a pending session', async () => {
    const at = plus(T0, 35 * MIN);
    const link = (await requestLink(db, OWNER, env, at))!;
    const s = (await consumeLink(db, link, env, at))!;
    expect(await submitCode(db, s, totpAt(secret, stepOf(at)), { ADMIN_EMAILS: '' }, at)).toBe('none');
  });

  it('an active session cannot submit a code again', async () => {
    const at = plus(T0, 40 * MIN);
    const s = await signIn(at);
    expect(await submitCode(db, s, totpAt(secret, stepOf(at) + 1), env, at)).toBe('none');
  });
});

describe('active sessions', () => {
  it('end when the address leaves the allow-list, or after 60 idle minutes', async () => {
    const at = plus(T0, 60 * MIN);
    const s = await signIn(at);
    expect(await getAdmin(db, s, { ADMIN_EMAILS: 'second@example.test' }, at)).toBeNull();
    expect(await getAdmin(db, s, env, plus(at, 61 * MIN))).toBeNull();
  });

  it('end after 12 hours even when used every 50 minutes', async () => {
    const at = plus(T0, 120 * MIN);
    const busy = await signIn(at);
    let t = at;
    for (let i = 0; i < 16; i++) {
      t = plus(t, 50 * MIN);
      const ok = await getAdmin(db, busy, env, t);
      if (t.getTime() - at.getTime() <= 12 * 60 * MIN) expect(ok).toEqual({ email: OWNER });
      else expect(ok).toBeNull();
    }
  });

  it('end on sign-out; junk tokens are nobody', async () => {
    const at = plus(T0, 900 * MIN);
    const out = await signIn(at);
    await endSession(db, out);
    expect(await getAdmin(db, out, env, at)).toBeNull();
    expect(await getAdmin(db, '', env, at)).toBeNull();
    expect(await getAdmin(db, 'x'.repeat(64), env, at)).toBeNull();
  });
});

describe('csrf', () => {
  it('is tied to the session token and compared safely', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    expect(checkCsrf(a, csrfToken(a))).toBe(true);
    expect(checkCsrf(a, csrfToken(b))).toBe(false);
    expect(checkCsrf(a, undefined)).toBe(false);
    expect(checkCsrf(a, null)).toBe(false);
    expect(checkCsrf(a, 'short')).toBe(false);
    expect(checkCsrf('', csrfToken(''))).toBe(false);
    expect(csrfToken(a)).not.toContain(a);
  });
});
