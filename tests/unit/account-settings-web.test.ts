// @vitest-environment node
// The settings POSTs and the unsubscribe endpoint (plan 3E Task 3). The account always comes from the session through
// requireAdultContext; form-supplied ids are ignored; a child context is refused on every adult POST. Export is a JSON
// attachment that is never cached and never carries a secret or another account's data. Deletion needs the typed email.
// PIN reset needs a fresh email sign-in. Unsubscribe answers the same whatever the token, and its GET changes nothing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { createChildProfile, listChildProfiles } from '@/lib/accounts/children';
import { checkPin } from '@/lib/accounts/pin';
import { switchToProfile } from '@/lib/accounts/context';
import { getSettings, TIME_ZONES } from '@/lib/accounts/settings';
import { unsubscribeToken } from '@/lib/accounts/unsubscribe';
import { createAccountActionLimits, createUnsubscribeLimits } from '@/lib/accounts/limits';
import {
  deleteAccountRequest,
  exportRequest,
  resetPinRequest,
  saveSettingsRequest,
  unsubscribeRequest,
} from '@/lib/accounts/settings-web';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-04T12:00:00Z');
const SECRET = 'test-only-unsubscribe-secret-0123456789abcdef';
const PIN = '4826';
const HEAD = {
  host: 'staging.sparkkindly.com',
  origin: 'https://staging.sparkkindly.com',
  'content-type': 'application/x-www-form-urlencoded',
};
let n = 0;

const post = (body: Record<string, string | string[]>, opts: { cookie?: string; origin?: string | null; url?: string } = {}) => {
  const headers: Record<string, string> = { ...HEAD };
  if (opts.origin === null) delete headers.origin;
  else if (opts.origin) headers.origin = opts.origin;
  if (opts.cookie) headers.cookie = `__Host-sk_account=${opts.cookie}`;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) for (const x of [v].flat()) params.append(k, x);
  return new Request(opts.url ?? 'http://localhost/x', { method: 'POST', headers, body: params.toString() });
};
const deps = (now = NOW) => ({ db, now });
const where = (r: Response) => [r.status, r.headers.get('location')];

async function account(dateOfBirth = '1990-05-05', parentEmail?: string) {
  const email = `sw${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth, parentEmail }, NOW);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, NOW))!, NOW))!;
  return { accountId: r.accountId, email, session };
}
async function family() {
  const a = await account();
  const p = await createChildProfile(db, a.accountId, { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: 'on', pin: PIN }, NOW);
  if (p.status !== 'created') throw new Error('profile not created');
  return { ...a, profileId: p.profileId };
}
async function childSession() {
  const f = await family();
  expect(await switchToProfile(db, f.session, f.profileId, NOW)).toBe(true);
  return f;
}
const exists = async (id: string) => (await db.query('SELECT 1 FROM accounts WHERE id = $1', [id])).rows.length === 1;

const SAVE_BODY = { time_zone: 'Europe/London', daily_set: 'on', invites: 'on' };
const ADULT_ROUTES = {
  save: saveSettingsRequest,
  export: exportRequest,
  delete: deleteAccountRequest,
  pin: resetPinRequest,
};

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

describe('every settings POST', () => {
  it('without a same-origin Origin is 403 and changes nothing', async () => {
    const f = await family();
    for (const fn of Object.values(ADULT_ROUTES)) {
      for (const origin of [null, 'https://evil.example']) {
        const r = await fn(post({ ...SAVE_BODY, email: f.email, new_pin: '1111', new_pin_confirm: '1111' }, { cookie: f.session, origin }), deps());
        expect(r.status).toBe(403);
      }
    }
    expect(await exists(f.accountId)).toBe(true);
    expect((await getSettings(db, f.accountId))?.notify.dailySet).toBe(false);
    expect(await checkPin(db, f.accountId, PIN, NOW)).toBe('ok');
  });

  it('with no session goes to sign-in', async () => {
    for (const fn of Object.values(ADULT_ROUTES)) {
      expect(where(await fn(post(SAVE_BODY), deps()))).toEqual([303, '/account/sign-in/']);
    }
  });
});

describe('a child context', () => {
  it('is refused (403) on save, export, delete and PIN reset, and nothing changes', async () => {
    const f = await childSession();
    const body = { ...SAVE_BODY, email: f.email, new_pin: '1111', new_pin_confirm: '1111' };
    for (const fn of Object.values(ADULT_ROUTES)) {
      const r = await fn(post(body, { cookie: f.session }), deps());
      expect(r.status).toBe(403);
      expect(await r.text()).not.toContain(f.email);
    }
    expect(await exists(f.accountId)).toBe(true);
    expect(await listChildProfiles(db, f.accountId)).toHaveLength(1);
    expect((await getSettings(db, f.accountId))?.timeZone).not.toBe('Europe/London');
    expect(await checkPin(db, f.accountId, PIN, NOW)).toBe('ok');
  });
});

describe('save', () => {
  it('stores the ticked preferences and the time zone for the session account only, ignoring form ids', async () => {
    const a = await account();
    const b = await account();
    const r = await saveSettingsRequest(post({ ...SAVE_BODY, account_id: b.accountId, profile_id: b.accountId }, { cookie: a.session }), deps());
    expect(where(r)).toEqual([303, '/account/settings/?r=saved#result']);
    expect(await getSettings(db, a.accountId)).toEqual({
      timeZone: 'Europe/London',
      notify: { dailySet: true, weeklyCircle: false, invites: true },
    });
    expect((await getSettings(db, b.accountId))?.notify).toEqual({ dailySet: false, weeklyCircle: false, invites: false });
    // unticking turns them off again
    await saveSettingsRequest(post({ time_zone: 'Europe/London' }, { cookie: a.session }), deps());
    expect((await getSettings(db, a.accountId))?.notify).toEqual({ dailySet: false, weeklyCircle: false, invites: false });
  });

  it('the page offers exactly the zones a save accepts', () => {
    expect(TIME_ZONES).toEqual([...Intl.supportedValuesOf('timeZone'), 'UTC']);
  });

  it('an unknown time zone changes nothing and says so', async () => {
    const a = await account();
    const before = await getSettings(db, a.accountId);
    const r = await saveSettingsRequest(post({ time_zone: 'Mars/Olympus', daily_set: 'on' }, { cookie: a.session }), deps());
    expect(where(r)).toEqual([303, '/account/settings/?r=invalid#result']);
    expect(await getSettings(db, a.accountId)).toEqual(before);
  });
});

describe('a consent-pending 13-15 account', () => {
  const teen = () => account(`${NOW.getUTCFullYear() - 14}-01-01`, 'parent@example.test');

  it('cannot save settings (interests only until a parent or guardian confirms): a neutral code, nothing saved', async () => {
    const t = await teen();
    const before = await getSettings(db, t.accountId);
    const r = await saveSettingsRequest(post(SAVE_BODY, { cookie: t.session }), deps());
    expect(where(r)).toEqual([303, '/account/settings/?r=pending#result']);
    expect(await getSettings(db, t.accountId)).toEqual(before);
  });

  it('saves once consent is confirmed', async () => {
    const t = await teen();
    await db.query("UPDATE accounts SET consent_state = 'confirmed' WHERE id = $1", [t.accountId]);
    expect(where(await saveSettingsRequest(post(SAVE_BODY, { cookie: t.session }), deps()))).toEqual([
      303,
      '/account/settings/?r=saved#result',
    ]);
    expect((await getSettings(db, t.accountId))?.timeZone).toBe('Europe/London');
  });
});

describe('per-account limits on export and PIN reset', () => {
  it('the 31st export in an hour gets 429 with nothing exported; another account is unaffected', async () => {
    const a = await account();
    const b = await account();
    const limit = createAccountActionLimits(() => 0);
    for (let i = 0; i < 30; i++) expect((await exportRequest(post({}, { cookie: a.session }), { ...deps(), limit })).status).toBe(200);
    const r = await exportRequest(post({}, { cookie: a.session }), { ...deps(), limit });
    expect(r.status).toBe(429);
    expect(await r.text()).toBe('Too many attempts. Please try again later.');
    expect((await exportRequest(post({}, { cookie: b.session }), { ...deps(), limit })).status).toBe(200);
  });

  it('the 31st PIN reset in an hour gets 429 and changes nothing', async () => {
    const f = await family();
    const limit = createAccountActionLimits(() => 0);
    const bad = { new_pin: '1357', new_pin_confirm: '1358' };
    for (let i = 0; i < 30; i++) await resetPinRequest(post(bad, { cookie: f.session }), { ...deps(), limit });
    const good = { new_pin: '1357', new_pin_confirm: '1357' };
    const r = await resetPinRequest(post(good, { cookie: f.session }), { ...deps(), limit });
    expect(r.status).toBe(429);
    expect(await r.text()).toBe('Too many attempts. Please try again later.');
    expect(await checkPin(db, f.accountId, PIN, NOW)).toBe('ok');
  });
});

describe('export', () => {
  it('is a no-store JSON attachment of the signed-in adult only, with no secrets', async () => {
    const f = await family();
    const other = await account();
    const r = await exportRequest(post({ account_id: other.accountId }, { cookie: f.session }), deps());
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^application\/json/);
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="sparkkindly-export.json"');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('location')).toBeNull();
    const text = await r.text();
    const body = JSON.parse(text);
    expect(body.account.email).toBe(f.email);
    expect(body.childProfiles.map((p: { displayName: string }) => p.displayName)).toEqual(['Mia']);
    expect(text).not.toContain(other.email);
    expect(text).not.toContain(other.accountId);
    expect(text).not.toContain(f.session);
    expect(text).not.toMatch(/pin_hash|pinHash|token|\$argon2|\$scrypt/i);
  });
});

describe('delete', () => {
  it('a mismatched email deletes nothing and never echoes the typed value', async () => {
    const a = await account();
    const r = await deleteAccountRequest(post({ email: 'Someone.Else@example.test' }, { cookie: a.session }), deps());
    expect(where(r)).toEqual([303, '/account/settings/delete/?r=mismatch#result']);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(r.headers.get('location')).not.toMatch(/someone/i);
    expect(await exists(a.accountId)).toBe(true);
  });

  it('the typed email (any case) deletes the session account only, clears the cookie and goes to sign-in', async () => {
    const f = await family();
    const b = await account();
    const r = await deleteAccountRequest(post({ email: ` ${f.email.toUpperCase()} `, account_id: b.accountId }, { cookie: f.session }), deps());
    expect(where(r)).toEqual([303, '/account/sign-in/?r=deleted']);
    expect(r.headers.get('set-cookie')).toBe('__Host-sk_account=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
    expect(await exists(f.accountId)).toBe(false);
    expect(await exists(b.accountId)).toBe(true);
    expect(await listChildProfiles(db, f.accountId)).toHaveLength(0);
  });

  it("typing another account's email deletes neither", async () => {
    const a = await account();
    const b = await account();
    const r = await deleteAccountRequest(post({ email: b.email }, { cookie: a.session }), deps());
    expect(where(r)).toEqual([303, '/account/settings/delete/?r=mismatch#result']);
    expect(await exists(a.accountId)).toBe(true);
    expect(await exists(b.accountId)).toBe(true);
  });
});

describe('PIN reset', () => {
  it('within 10 minutes of the email sign-in sets the new PIN and returns with a code', async () => {
    const f = await family();
    const later = new Date(NOW.getTime() + 9 * 60_000);
    const r = await resetPinRequest(post({ new_pin: '1357', new_pin_confirm: '1357' }, { cookie: f.session }), deps(later));
    expect(where(r)).toEqual([303, '/account/settings/?r=pin-reset#result']);
    expect(await checkPin(db, f.accountId, '1357', later)).toBe('ok');
    expect(r.headers.get('location')).not.toContain('1357');
  });

  it('from a stale session is refused with the sign-in-again code and changes nothing', async () => {
    const f = await family();
    const later = new Date(NOW.getTime() + 11 * 60_000);
    const r = await resetPinRequest(post({ new_pin: '1357', new_pin_confirm: '1357' }, { cookie: f.session }), deps(later));
    expect(where(r)).toEqual([303, '/account/settings/?r=pin-stale#result']);
    expect(await checkPin(db, f.accountId, PIN, later)).toBe('ok');
  });

  it('a stale session says so first, even with mismatched or bad PINs', async () => {
    const f = await family();
    const later = new Date(NOW.getTime() + 11 * 60_000);
    for (const body of [{ new_pin: '1357', new_pin_confirm: '1358' }, { new_pin: '12a4', new_pin_confirm: '12a4' }]) {
      const r = await resetPinRequest(post(body, { cookie: f.session }), deps(later));
      expect(where(r)).toEqual([303, '/account/settings/?r=pin-stale#result']);
    }
    expect(await checkPin(db, f.accountId, PIN, later)).toBe('ok');
  });

  it('two different PINs or a bad PIN change nothing', async () => {
    const f = await family();
    for (const body of [{ new_pin: '1357', new_pin_confirm: '1358' }, { new_pin: '12a4', new_pin_confirm: '12a4' }]) {
      const r = await resetPinRequest(post(body, { cookie: f.session }), deps());
      expect(where(r)).toEqual([303, '/account/settings/?r=pin-invalid#result']);
    }
    expect(await checkPin(db, f.accountId, PIN, NOW)).toBe('ok');
  });
});

describe('unsubscribe', () => {
  const env = { UNSUBSCRIBE_SECRET: SECRET };
  const oneClick = (t: string, opts: { origin?: string | null } = {}) =>
    post({ 'List-Unsubscribe': 'One-Click' }, { url: `https://staging.sparkkindly.com/account/unsubscribe/confirm/?t=${encodeURIComponent(t)}`, ...opts });
  const udeps = (e: Record<string, string> = env) => ({ db, env: e, limits: createUnsubscribeLimits() });

  it('a valid one-click POST (any origin, no session) turns off only that preference', async () => {
    const a = await account();
    await saveSettingsRequest(post({ time_zone: 'UTC', daily_set: 'on', weekly: 'on', invites: 'on' }, { cookie: a.session }), deps());
    const r = await unsubscribeRequest(oneClick(unsubscribeToken(SECRET, a.accountId, 'weekly_circle')!, { origin: null }), udeps());
    expect(r.status).toBe(200);
    expect((await getSettings(db, a.accountId))?.notify).toEqual({ dailySet: true, weeklyCircle: false, invites: true });
  });

  it('a bad token, a foreign signature and a missing secret change nothing and answer identically', async () => {
    const a = await account();
    await saveSettingsRequest(post({ time_zone: 'UTC', daily_set: 'on' }, { cookie: a.session }), deps());
    const good = unsubscribeToken(SECRET, a.accountId, 'invites')!; // invites is already off: a no-op
    const answers = [];
    for (const [t, e] of [
      [good, env],
      ['garbage', env],
      [unsubscribeToken('another-secret-of-enough-length-0123456789', a.accountId, 'daily_set')!, env],
      [unsubscribeToken(SECRET, a.accountId, 'daily_set')!, {}],
      [unsubscribeToken(SECRET, a.accountId, 'daily_set')!, { UNSUBSCRIBE_SECRET: 'short' }],
    ] as const) {
      const r = await unsubscribeRequest(oneClick(t), udeps(e));
      answers.push([r.status, r.headers.get('location'), await r.text()]);
    }
    expect(new Set(answers.map((x) => JSON.stringify(x))).size).toBe(1);
    expect((await getSettings(db, a.accountId))?.notify.dailySet).toBe(true);
  });

  it("the page's confirm form (token in the body) gets the same redirect whatever the token", async () => {
    const a = await account();
    await saveSettingsRequest(post({ time_zone: 'UTC', daily_set: 'on' }, { cookie: a.session }), deps());
    const good = await unsubscribeRequest(post({ t: unsubscribeToken(SECRET, a.accountId, 'daily_set')! }), udeps());
    const bad = await unsubscribeRequest(post({ t: 'nope' }), udeps());
    expect(where(good)).toEqual([303, '/account/unsubscribe/?r=done#result']);
    expect(where(bad)).toEqual(where(good));
    expect((await getSettings(db, a.accountId))?.notify.dailySet).toBe(false);
  });

  it('invalid or absent tokens are rate limited per network', async () => {
    const limits = createUnsubscribeLimits();
    let last = 0;
    for (let i = 0; i < 61; i++) {
      const r = await unsubscribeRequest(oneClick('x'), { db, env, limits });
      last = r.status;
    }
    expect(last).toBe(429);
    expect((await unsubscribeRequest(post({}), { db, env, limits })).status).toBe(429);
  });

  it('valid tokens skip the limiter, so a shared mail-provider address is never throttled', async () => {
    const a = await account();
    await saveSettingsRequest(post({ time_zone: 'UTC', daily_set: 'on' }, { cookie: a.session }), deps());
    const limits = createUnsubscribeLimits();
    for (let i = 0; i < 60; i++) await unsubscribeRequest(oneClick('x'), { db, env, limits });
    const r = await unsubscribeRequest(oneClick(unsubscribeToken(SECRET, a.accountId, 'daily_set')!), { db, env, limits });
    expect(r.status).toBe(200);
    expect((await getSettings(db, a.accountId))?.notify.dailySet).toBe(false);
  });

  const queryUrl = (t: string) => `https://staging.sparkkindly.com/account/unsubscribe/confirm/?t=${encodeURIComponent(t)}`;
  const multipart = (t: string) => {
    const body = new FormData();
    body.set('List-Unsubscribe', 'One-Click');
    return new Request(queryUrl(t), { method: 'POST', body });
  };
  const bare = (t: string) => new Request(queryUrl(t), { method: 'POST' });

  it('a one-click POST with the token in the URL gets a 200, never a redirect, whatever the body encoding', async () => {
    for (const shape of [multipart, bare, (t: string) => post({ 'List-Unsubscribe': 'One-Click' }, { url: queryUrl(t), origin: null }), (t: string) => post({}, { url: queryUrl(t) })]) {
      const a = await account();
      await saveSettingsRequest(post({ time_zone: 'UTC', daily_set: 'on' }, { cookie: a.session }), deps());
      const good = await unsubscribeRequest(shape(unsubscribeToken(SECRET, a.accountId, 'daily_set')!), udeps());
      const bad = await unsubscribeRequest(shape('nope'), udeps());
      expect(good.status).toBe(200);
      expect(good.headers.get('location')).toBeNull();
      expect(good.headers.get('content-type')).toMatch(/^text\/plain/);
      expect([bad.status, await bad.text()]).toEqual([good.status, await good.text()]);
      expect((await getSettings(db, a.accountId))?.notify.dailySet).toBe(false);
    }
  });

  it('a database error while applying a valid token answers 503, not success', async () => {
    const a = await account();
    const broken = { query: async () => { throw new Error('connection lost'); } } as unknown as TestDb;
    const r = await unsubscribeRequest(oneClick(unsubscribeToken(SECRET, a.accountId, 'daily_set')!), { db: broken, env, limits: createUnsubscribeLimits() });
    expect(r.status).toBe(503);
    expect(await r.text()).toBe('Please try again later.');
  });
});
