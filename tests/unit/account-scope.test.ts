// @vitest-environment node
// The scope every public page reads with (plan 3D, Task 2): the signed-in context's audiences, or the anonymous scope.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { requestAccountLink, consumeAccountLink } from '@/lib/accounts/sessions';
import { createChildProfile } from '@/lib/accounts/children';
import { switchToProfile } from '@/lib/accounts/context';
import { scopeForSession } from '@/lib/accounts/scope';
import type { Db } from '@/lib/db';
import { newToken } from '@/lib/tokens';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const DAY = 24 * 60 * 60_000;
const env = { ADMIN_EMAILS: 'nobody@example.test' };
const ANON = ['kids', 'all', 'adults'];

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

async function signIn(email: string, dateOfBirth: string, parentEmail?: string) {
  const r = await signUp(db, { email, dateOfBirth, parentEmail }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, env, T0))!, T0))!;
  return { accountId: r.accountId, session };
}

describe('scopeForSession', () => {
  it('no cookie, a garbage cookie or an unknown token is the anonymous scope, at the given time', async () => {
    for (const t of [undefined, '', 'nope', "' OR 1=1 --", newToken()]) {
      const s = await scopeForSession(db, t, T0);
      expect([...s.audiences], String(t)).toEqual(ANON);
      expect(s.now).toBe(T0);
    }
  });

  it('an expired session is the anonymous scope', async () => {
    const { session } = await signIn('expired@example.test', '1990-01-01');
    expect([...(await scopeForSession(db, session, new Date(T0.getTime() + 31 * DAY))).audiences]).toEqual(ANON);
  });

  it('any database error fails to the anonymous scope', async () => {
    const broken = { query: async () => Promise.reject(new Error('down')) } as unknown as Db;
    expect([...(await scopeForSession(broken, newToken(), T0)).audiences]).toEqual(ANON);
  });

  it('an adult or teen session sees all three audiences', async () => {
    const adult = await signIn('adult@example.test', '1990-01-01');
    const teen = await signIn('teen@example.test', '2012-01-01', 'parent@example.test');
    for (const { session } of [adult, teen]) {
      expect([...(await scopeForSession(db, session, T0)).audiences].sort()).toEqual(['adults', 'all', 'kids']);
    }
  });

  it('a child context sees exactly kids and all', async () => {
    const { accountId, session } = await signIn('family@example.test', '1985-01-01');
    const p = await createChildProfile(db, accountId, { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (p.status !== 'created') throw new Error('profile not created');
    expect(await switchToProfile(db, session, p.profileId, T0)).toBe(true);
    const s = await scopeForSession(db, session, T0);
    expect([...s.audiences]).toEqual(['kids', 'all']);
    expect(s.now).toBe(T0);
  });
});

describe('currentScope (Next glue)', () => {
  it('with ACCOUNTS_ENABLED off it never reads the cookie and is anonymous', async () => {
    vi.resetModules();
    const cookies = vi.fn();
    vi.doMock('next/headers', () => ({ cookies }));
    vi.doMock('@/lib/db', () => ({ getDb: () => db }));
    vi.stubEnv('ACCOUNTS_ENABLED', '');
    try {
      const { currentScope } = await import('@/lib/accounts/scope-next');
      expect([...(await currentScope()).audiences]).toEqual(ANON);
      expect(cookies).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.doUnmock('next/headers');
      vi.doUnmock('@/lib/db');
    }
  });

  it('with the flag on it reads the account cookie and uses the session context', async () => {
    const { accountId, session } = await signIn('glue@example.test', '1985-01-01');
    const p = await createChildProfile(db, accountId, { displayName: 'Leo', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (p.status !== 'created') throw new Error('profile not created');
    await switchToProfile(db, session, p.profileId, T0);
    vi.resetModules();
    const get = vi.fn((name: string) => (name === '__Host-sk_account' ? { value: session } : undefined));
    vi.doMock('next/headers', () => ({ cookies: async () => ({ get }) }));
    vi.doMock('@/lib/db', () => ({ getDb: () => db }));
    vi.stubEnv('ACCOUNTS_ENABLED', 'true');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    try {
      const { currentScope } = await import('@/lib/accounts/scope-next');
      expect([...(await currentScope()).audiences]).toEqual(['kids', 'all']);
      expect(get).toHaveBeenCalledWith('__Host-sk_account');
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.doUnmock('next/headers');
      vi.doUnmock('@/lib/db');
    }
  });
});
