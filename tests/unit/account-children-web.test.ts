// @vitest-environment node
// The child-profile POSTs (plan 3C Task 3). The account id always comes from the session through requireAdultContext;
// a form's account or owner id is ignored; delete and switch take only a profile id, checked against the session's own
// account. A PIN is never echoed in a redirect, a body or a log, and wrong and locked PIN answers carry no counts.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { createChildProfile, listChildProfiles } from '@/lib/accounts/children';
import { checkPin } from '@/lib/accounts/pin';
import { getContext, switchToProfile } from '@/lib/accounts/context';
import {
  changePinRequest,
  createChildRequest,
  deleteChildRequest,
  switchBackRequest,
  switchToChildRequest,
} from '@/lib/accounts/children-web';
import { resendConsentRequest } from '@/lib/accounts/consent-web';
import { signOut } from '@/lib/accounts/web';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-04T12:00:00Z');
const PIN = '4826';
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
const deps = () => ({ db, now: NOW });
const where = (r: Response) => [r.status, r.headers.get('location')];

async function account(dateOfBirth = '1990-05-05') {
  const email = `cw${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth }, NOW);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, NOW))!, NOW))!;
  return { accountId: r.accountId, session };
}
// An adult with one profile (PIN 4826) and a session.
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
const pinState = async (id: string) =>
  (await db.query<{ pin_hash: string; pin_failures: number }>('SELECT pin_hash, pin_failures FROM accounts WHERE id = $1', [id])).rows[0];

// Nothing a browser or a log can see may carry a PIN.
async function noPin(r: Response, pins: string[]) {
  const seen = `${r.headers.get('location') ?? ''} ${await r.clone().text()}`;
  for (const p of pins) expect(seen).not.toContain(p);
}

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

const ROUTES = {
  create: createChildRequest,
  delete: deleteChildRequest,
  switch: switchToChildRequest,
  back: switchBackRequest,
  pin: changePinRequest,
};

describe('every child-profile POST', () => {
  it('without a same-origin Origin is 403 and changes nothing', async () => {
    const f = await family();
    for (const fn of Object.values(ROUTES)) {
      for (const origin of [null, 'https://evil.example']) {
        const r = await fn(post({ profile_id: f.profileId, display_name: 'Leo', age_band: '6-9', guardian: 'on' }, { cookie: f.session, origin }), deps());
        expect(r.status).toBe(403);
      }
    }
    expect(await listChildProfiles(db, f.accountId)).toHaveLength(1);
    expect((await getContext(db, f.session, NOW))?.profile).toBeNull();
  });

  it('with no session goes to sign-in', async () => {
    for (const fn of Object.values(ROUTES)) {
      expect(where(await fn(post({ pin: PIN }), deps()))).toEqual([303, '/account/sign-in/']);
    }
  });
});

describe('a child context', () => {
  it('is refused (403) on create, delete, switch, PIN change and the consent resend, and nothing changes', async () => {
    const f = await childSession();
    const before = await pinState(f.accountId);
    const body = { profile_id: f.profileId, display_name: 'Leo', age_band: '6-9', guardian: 'on', current_pin: PIN, new_pin: '1111', new_pin_confirm: '1111' };
    for (const fn of [createChildRequest, deleteChildRequest, switchToChildRequest, changePinRequest]) {
      expect((await fn(post(body, { cookie: f.session }), deps())).status).toBe(403);
    }
    const resend = await resendConsentRequest(post({}, { cookie: f.session }), { ...deps(), env: {}, send: async () => ({}), defer: () => {} });
    expect(resend.status).toBe(403);
    const out = await signOut(post({}, { cookie: f.session }), { ...deps(), env: {}, send: async () => ({}), defer: () => {} });
    expect(out.status).toBe(403);
    expect(out.headers.get('set-cookie')).toBeNull();
    expect(await listChildProfiles(db, f.accountId)).toHaveLength(1);
    expect(await pinState(f.accountId)).toEqual(before);
    expect((await getContext(db, f.session, NOW))?.profile?.id).toBe(f.profileId);
  });
});

describe('createChildRequest', () => {
  it('creates the first profile with a confirmed PIN under the session account, ignoring any account or owner id in the form', async () => {
    const a = await account();
    const other = await account();
    const r = await createChildRequest(
      post(
        { display_name: 'Ava', age_band: '10-12', guardian: 'on', pin: PIN, pin_confirm: PIN, account_id: other.accountId, owner_id: other.accountId },
        { cookie: a.session },
      ),
      deps(),
    );
    expect(where(r)).toEqual([303, '/account/children/?r=created#result']);
    await noPin(r, [PIN]);
    expect((await listChildProfiles(db, a.accountId)).map((p) => [p.displayName, p.ageBand])).toEqual([['Ava', '10-12']]);
    expect(await listChildProfiles(db, other.accountId)).toEqual([]);
    expect(await checkPin(db, a.accountId, PIN, NOW)).toBe('ok');
  });

  it('first profile: no PIN is pin, a mismatched confirmation is mismatch, no guardian box is invalid; nothing is created', async () => {
    const a = await account();
    const base = { display_name: 'Ava', age_band: '6-9', guardian: 'on' };
    const cases: [Record<string, string>, string][] = [
      [base, 'pin'],
      [{ ...base, pin: PIN, pin_confirm: '4827' }, 'mismatch'],
      [{ display_name: 'Ava', age_band: '6-9', pin: PIN, pin_confirm: PIN }, 'invalid'],
      [{ ...base, age_band: '13-15', pin: PIN, pin_confirm: PIN }, 'invalid'],
    ];
    for (const [body, code] of cases) {
      const r = await createChildRequest(post(body, { cookie: a.session }), deps());
      expect(where(r)).toEqual([303, `/account/children/?r=${code}#result`]);
      await noPin(r, [PIN, '4827']);
    }
    expect(await listChildProfiles(db, a.accountId)).toEqual([]);
  });

  it('a later profile needs no PIN, and a PIN in the form does not change the existing one', async () => {
    const f = await family();
    const r = await createChildRequest(post({ display_name: 'Leo', age_band: '6-9', guardian: 'on', pin: '9999', pin_confirm: '9999' }, { cookie: f.session }), deps());
    expect(where(r)).toEqual([303, '/account/children/?r=created#result']);
    expect(await listChildProfiles(db, f.accountId)).toHaveLength(2);
    expect(await checkPin(db, f.accountId, PIN, NOW)).toBe('ok');
  });

  it('a 16-year-old is not allowed', async () => {
    const t = await account('2010-01-01');
    const r = await createChildRequest(post({ display_name: 'Ava', age_band: '6-9', guardian: 'on', pin: PIN, pin_confirm: PIN }, { cookie: t.session }), deps());
    expect(where(r)).toEqual([303, '/account/children/?r=no#result']);
    expect(await listChildProfiles(db, t.accountId)).toEqual([]);
  });
});

describe('deleteChildRequest and switchToChildRequest take only a profile id, checked against the session account', () => {
  it('deletes its own profile; another account\'s profile id is gone and the row stays', async () => {
    const a = await family();
    const b = await family();
    expect(where(await deleteChildRequest(post({ profile_id: b.profileId, account_id: b.accountId }, { cookie: a.session }), deps()))).toEqual([
      303,
      '/account/children/?r=gone#result',
    ]);
    expect(await listChildProfiles(db, b.accountId)).toHaveLength(1);
    expect(where(await deleteChildRequest(post({ profile_id: a.profileId }, { cookie: a.session }), deps()))).toEqual([
      303,
      '/account/children/?r=deleted#result',
    ]);
    expect(await listChildProfiles(db, a.accountId)).toEqual([]);
  });

  it('switches into its own profile; a foreign or malformed id changes nothing', async () => {
    const a = await family();
    const b = await family();
    for (const id of [b.profileId, 'nope', '']) {
      expect(where(await switchToChildRequest(post({ profile_id: id }, { cookie: a.session }), deps()))).toEqual([
        303,
        '/account/children/?r=gone#result',
      ]);
    }
    expect((await getContext(db, a.session, NOW))?.profile).toBeNull();
    expect(where(await switchToChildRequest(post({ profile_id: a.profileId }, { cookie: a.session }), deps()))).toEqual([
      303,
      '/account/children/playing/',
    ]);
    expect((await getContext(db, a.session, NOW))?.profile?.id).toBe(a.profileId);
  });
});

describe('switchBackRequest', () => {
  it('a wrong PIN stays in the child context; the right one returns to the adult', async () => {
    const f = await childSession();
    const wrong = await switchBackRequest(post({ pin: '0000' }, { cookie: f.session }), deps());
    expect(where(wrong)).toEqual([303, '/account/children/playing/?r=wrong#result']);
    await noPin(wrong, ['0000', PIN]);
    expect((await getContext(db, f.session, NOW))?.profile?.id).toBe(f.profileId);
    const ok = await switchBackRequest(post({ pin: PIN }, { cookie: f.session }), deps());
    expect(where(ok)).toEqual([303, '/account/children/']);
    await noPin(ok, [PIN]);
    expect((await getContext(db, f.session, NOW))?.profile).toBeNull();
  });

  it('after five wrong PINs entry is locked, neutrally, even for the right PIN', async () => {
    const f = await childSession();
    for (let i = 0; i < 5; i++) await switchBackRequest(post({ pin: '0000' }, { cookie: f.session }), deps());
    const r = await switchBackRequest(post({ pin: PIN }, { cookie: f.session }), deps());
    expect(where(r)).toEqual([303, '/account/children/playing/?r=locked#result']);
    expect(await r.text()).toBe('');
    expect((await getContext(db, f.session, NOW))?.profile?.id).toBe(f.profileId);
  });

  it('the adult context can still sign out', async () => {
    const f = await family();
    const r = await signOut(post({}, { cookie: f.session }), { ...deps(), env: {}, send: async () => ({}), defer: () => {} });
    expect(where(r)).toEqual([303, '/account/sign-in/']);
    expect(await getContext(db, f.session, NOW)).toBeNull();
  });

  it('from an adult context it only goes back to the list: no PIN is checked, nothing counts', async () => {
    const f = await family();
    const r = await switchBackRequest(post({ pin: '0000' }, { cookie: f.session }), deps());
    expect(where(r)).toEqual([303, '/account/children/']);
    expect((await pinState(f.accountId)).pin_failures).toBe(0);
  });
});

describe('changePinRequest', () => {
  it('needs the current PIN; a wrong one is refused and counts; the right one changes it', async () => {
    const f = await family();
    const wrong = await changePinRequest(post({ current_pin: '0000', new_pin: '1357', new_pin_confirm: '1357' }, { cookie: f.session }), deps());
    expect(where(wrong)).toEqual([303, '/account/children/?r=wrong#result']);
    expect((await pinState(f.accountId)).pin_failures).toBe(1);
    const mismatch = await changePinRequest(post({ current_pin: PIN, new_pin: '1357', new_pin_confirm: '1358' }, { cookie: f.session }), deps());
    expect(where(mismatch)).toEqual([303, '/account/children/?r=pin-invalid#result']);
    const ok = await changePinRequest(post({ current_pin: PIN, new_pin: '1357', new_pin_confirm: '1357' }, { cookie: f.session }), deps());
    expect(where(ok)).toEqual([303, '/account/children/?r=pin-changed#result']);
    await noPin(ok, [PIN, '1357']);
    expect(await checkPin(db, f.accountId, '1357', NOW)).toBe('ok');
  });

  it('a locked account cannot change its PIN', async () => {
    const f = await family();
    for (let i = 0; i < 5; i++) await checkPin(db, f.accountId, '0000', NOW);
    const r = await changePinRequest(post({ current_pin: PIN, new_pin: '1357', new_pin_confirm: '1357' }, { cookie: f.session }), deps());
    expect(where(r)).toEqual([303, '/account/children/?r=locked#result']);
  });
});

it('no PIN reaches a log line', async () => {
  const spies = (['log', 'error', 'warn', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  const f = await childSession();
  await switchBackRequest(post({ pin: '0000' }, { cookie: f.session }), deps());
  await switchBackRequest(post({ pin: PIN }, { cookie: f.session }), deps());
  await changePinRequest(post({ current_pin: PIN, new_pin: '2468', new_pin_confirm: '2468' }, { cookie: f.session }), deps());
  const logged = spies.flatMap((s) => s.mock.calls.flat().map(String)).join(' ');
  for (const p of ['0000', PIN, '2468']) expect(logged).not.toContain(p);
  spies.forEach((s) => s.mockRestore());
});
