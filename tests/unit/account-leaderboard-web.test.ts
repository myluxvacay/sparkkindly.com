// @vitest-environment node
// The public-leaderboard settings POST (Project 4.11, ADR 0004): the account comes only from the session; the
// public_leaderboard capability (16+) gates the save; a child context is refused; outcome codes ride the redirect.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { createChildProfile } from '@/lib/accounts/children';
import { switchToProfile } from '@/lib/accounts/context';
import { getLeaderboardProfile } from '@/lib/accounts/leaderboard';
import { saveLeaderboardRequest } from '@/lib/accounts/leaderboard-web';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-04T12:00:00Z');
const HEAD = {
  host: 'staging.sparkkindly.com',
  origin: 'https://staging.sparkkindly.com',
  'content-type': 'application/x-www-form-urlencoded',
};
let n = 0;

const post = (body: Record<string, string>, opts: { cookie?: string; origin?: string | null } = {}) => {
  const headers: Record<string, string> = { ...HEAD };
  if (opts.origin === null) delete headers.origin;
  else if (opts.origin) headers.origin = opts.origin;
  if (opts.cookie) headers.cookie = `__Host-sk_account=${opts.cookie}`;
  return new Request('http://localhost/x', { method: 'POST', headers, body: new URLSearchParams(body).toString() });
};
const where = (r: Response) => [r.status, r.headers.get('location')];

async function account(dateOfBirth = '1990-05-05', parentEmail?: string) {
  const email = `lw${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth, parentEmail }, NOW);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, NOW))!, NOW))!;
  return { accountId: r.accountId, email, session };
}

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

describe('saveLeaderboardRequest', () => {
  it('saves an adult opt-in and redirects with lb-saved', async () => {
    const a = await account();
    const r = await saveLeaderboardRequest(
      post({ opt_in: 'on', public_name: 'Sunny Sam', avatar_key: 'wave' }, { cookie: a.session }),
      { db, now: NOW },
    );
    expect(where(r)).toEqual([303, '/account/settings/?r=lb-saved#result']);
    expect(await getLeaderboardProfile(db, a.accountId)).toEqual({ optIn: true, publicName: 'Sunny Sam', avatarKey: 'wave' });
  });

  it('allows a 16-17 member and refuses a 13-15 member', async () => {
    const older = await account('2009-06-01');
    const r1 = await saveLeaderboardRequest(
      post({ opt_in: 'on', public_name: 'Older Teen', avatar_key: 'star' }, { cookie: older.session }),
      { db, now: NOW },
    );
    expect(where(r1)).toEqual([303, '/account/settings/?r=lb-saved#result']);

    const younger = await account('2012-06-01', 'parent@example.test');
    const r2 = await saveLeaderboardRequest(
      post({ opt_in: 'on', public_name: 'Young Teen', avatar_key: 'star' }, { cookie: younger.session }),
      { db, now: NOW },
    );
    expect(where(r2)).toEqual([303, '/account/settings/?r=lb-ineligible#result']);
    expect((await getLeaderboardProfile(db, younger.accountId))?.optIn).toBe(false);
  });

  it('reports a blocked name and writes nothing', async () => {
    const a = await account();
    const r = await saveLeaderboardRequest(
      post({ opt_in: 'on', public_name: 'oh shit', avatar_key: 'wave' }, { cookie: a.session }),
      { db, now: NOW },
    );
    expect(where(r)).toEqual([303, '/account/settings/?r=lb-blocked#result']);
    expect((await getLeaderboardProfile(db, a.accountId))?.optIn).toBe(false);
  });

  it('without a same-origin Origin is 403, and a child context is refused', async () => {
    const a = await account();
    const r = await saveLeaderboardRequest(
      post({ opt_in: 'on', public_name: 'Sam', avatar_key: 'wave' }, { cookie: a.session, origin: null }),
      { db, now: NOW },
    );
    expect(r.status).toBe(403);

    const p = await createChildProfile(db, a.accountId, { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, NOW);
    if (p.status !== 'created') throw new Error('profile not created');
    expect(await switchToProfile(db, a.session, p.profileId, NOW)).toBe(true);
    const r2 = await saveLeaderboardRequest(
      post({ opt_in: 'on', public_name: 'Sam', avatar_key: 'wave' }, { cookie: a.session }),
      { db, now: NOW },
    );
    expect(r2.status).toBe(403);
  });
});
