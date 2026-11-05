// @vitest-environment node
// The circle POSTs and the circle page loader (plan 4A Task 3). Both flags gate everything; the account always comes
// from the session (an account id in a form is ignored); a child context gets 403; a non-member sees a 404.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { createChildProfile } from '@/lib/accounts/children';
import { switchToProfile } from '@/lib/accounts/context';
import { getCircleForMember } from '@/lib/circles/repo';
import {
  addChildRequest,
  closeCircleRequest,
  createCircleRequest,
  leaveCircleRequest,
  loadCirclePage,
  removeChildRequest,
  removeMemberRequest,
  transferRequest,
} from '@/lib/circles/web';

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
const deps = (limit: (id: string) => boolean = () => true) => ({ db, now: NOW, limit });
const where = (r: Response) => [r.status, r.headers.get('location')];

async function account(dateOfBirth = '1990-05-05') {
  const email = `cweb${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth }, NOW);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, NOW))!, NOW))!;
  return { id: r.accountId, email, session };
}
async function created(cookie: string, body: Record<string, string> = {}) {
  const r = await createCircleRequest(post({ name: 'Home', kind: 'family', your_name: 'Mum', ...body }, { cookie }), deps());
  const m = /^\/circles\/([a-z0-9]{10})\/\?r=created#result$/.exec(r.headers.get('location') ?? '');
  if (!m) throw new Error(`not created: ${r.headers.get('location')}`);
  return m[1];
}
async function join(slug: string, accountId: string, name = 'Bea') {
  await db.query(
    'INSERT INTO circle_members (circle_id, account_id, display_name) SELECT id, $2, $3 FROM circles WHERE slug = $1',
    [slug, accountId, name],
  );
}
// The opaque key the owner's page posts for a member (4A review: no account or profile ids in the owner's forms).
async function keyOf(slug: string, ownerId: string, name: string) {
  return (await getCircleForMember(db, ownerId, slug))!.members.find((m) => m.name === name)!.key!;
}
async function profile(accountId: string) {
  const p = await createChildProfile(db, accountId, { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, NOW);
  if (p.status !== 'created') throw new Error('profile failed');
  return p.profileId;
}

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('CIRCLES_ENABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

type Route = (r: Request, d: ReturnType<typeof deps>, slug: string) => Promise<Response>;
const SCOPED: Record<string, Route> = {
  leave: leaveCircleRequest,
  remove: removeMemberRequest,
  transfer: transferRequest,
  close: closeCircleRequest,
  addChild: addChildRequest,
  removeChild: removeChildRequest,
};
const all = (slug: string): [string, (r: Request) => Promise<Response>][] => [
  ['create', (r) => createCircleRequest(r, deps())],
  ...Object.entries(SCOPED).map(([k, fn]): [string, (r: Request) => Promise<Response>] => [k, (r) => fn(r, deps(), slug)]),
];

describe('every circle route', () => {
  it('is a 404 with either flag off, and the page loader finds nothing', async () => {
    const a = await account();
    const slug = await created(a.session);
    for (const [accounts, circles] of [['true', ''], ['', 'true'], ['', '']]) {
      vi.stubEnv('ACCOUNTS_ENABLED', accounts);
      vi.stubEnv('CIRCLES_ENABLED', circles);
      for (const [name, fn] of all(slug)) expect((await fn(post({}, { cookie: a.session }))).status, name).toBe(404);
      expect(await loadCirclePage(db, a.session, slug, NOW)).toEqual({ status: 'not_found' });
    }
  });

  it('refuses a missing or foreign Origin (403), sends no session to sign-in, and gives a child context 403', async () => {
    const a = await account();
    const slug = await created(a.session);
    const mia = await profile(a.id);
    for (const [name, fn] of all(slug)) {
      for (const origin of [null, 'https://evil.example']) {
        expect((await fn(post({}, { cookie: a.session, origin }))).status, name).toBe(403);
      }
      expect(where(await fn(post({}))), name).toEqual([303, '/account/sign-in/']);
    }
    expect(await switchToProfile(db, a.session, mia, NOW)).toBe(true);
    for (const [name, fn] of all(slug)) {
      expect((await fn(post({ confirm: 'on', profile_id: mia }, { cookie: a.session }))).status, name).toBe(403);
    }
    expect(await loadCirclePage(db, a.session, slug, NOW)).toEqual({ status: 'child' });
    expect((await getCircleForMember(db, a.id, slug))!.members).toHaveLength(1);
  });

  it('is limited per account (429)', async () => {
    const a = await account();
    const slug = await created(a.session);
    const no = deps(() => false);
    expect((await createCircleRequest(post({ name: 'X', kind: 'friends', your_name: 'Me' }, { cookie: a.session }), no)).status).toBe(429);
    for (const [name, fn] of Object.entries(SCOPED)) {
      expect((await fn(post({ confirm: 'on' }, { cookie: a.session }), no, slug)).status, name).toBe(429);
    }
  });
});

describe('create', () => {
  it('ignores any account id in the form; the session account owns the circle', async () => {
    const a = await account();
    const b = await account();
    const slug = await created(a.session, { account_id: b.id, owner_account_id: b.id });
    expect((await getCircleForMember(db, a.id, slug))!.myRole).toBe('owner');
    expect(await getCircleForMember(db, b.id, slug)).toBeNull();
  });

  it('sends invalid, refused and over-limit outcomes back to the form', async () => {
    const a = await account();
    const teen = await account('2010-01-01');
    const r = (cookie: string, body: Record<string, string>) =>
      createCircleRequest(post({ name: 'Home', kind: 'friends', your_name: 'Me', ...body }, { cookie }), deps());
    expect(where(await r(a.session, { name: '' }))).toEqual([303, '/circles/new/?r=invalid#result']);
    expect(where(await r(teen.session, { kind: 'family' }))).toEqual([303, '/circles/new/?r=no#result']);
    for (let i = 0; i < 5; i++) await created(a.session);
    expect(where(await r(a.session, {}))).toEqual([303, '/circles/new/?r=limit#result']);
  });
});

describe('circle-scoped POSTs', () => {
  it('a stranger, a forged slug or a malformed slug gets the neutral "not available" answer and changes nothing', async () => {
    const a = await account();
    const s = await account();
    const slug = await created(a.session);
    for (const target of [slug, 'zzzzzzzzzz', '../evil', 'x?r=1']) {
      for (const [name, fn] of Object.entries(SCOPED)) {
        const res = await fn(post({ confirm: 'on', member_key: '0123456789abcdef', to_member: '0123456789abcdef' }, { cookie: s.session }), deps(), target);
        expect(where(res), `${name} ${target}`).toEqual([303, '/circles/?r=gone#result']);
      }
    }
    expect((await getCircleForMember(db, a.id, slug))!.status).toBe('open');
  });

  it('owner actions need the confirm box; a plain member is refused', async () => {
    const a = await account();
    const b = await account();
    const slug = await created(a.session);
    await join(slug, b.id);
    const back = (code: string) => [303, `/circles/${slug}/?r=${code}#result`];
    expect(where(await closeCircleRequest(post({}, { cookie: a.session }), deps(), slug))).toEqual(back('confirm'));
    const bKey = await keyOf(slug, a.id, 'Bea');
    const aKey = await keyOf(slug, a.id, 'Mum');
    expect(where(await removeMemberRequest(post({ member_key: bKey }, { cookie: a.session }), deps(), slug))).toEqual(back('confirm'));
    expect(where(await transferRequest(post({ to_member: bKey }, { cookie: a.session }), deps(), slug))).toEqual(back('confirm'));
    expect(where(await closeCircleRequest(post({ confirm: 'on' }, { cookie: b.session }), deps(), slug))).toEqual(back('not-owner'));
    expect(where(await removeMemberRequest(post({ confirm: 'on', member_key: aKey }, { cookie: b.session }), deps(), slug))).toEqual(back('not-owner'));
    expect(where(await transferRequest(post({ confirm: 'on', to_member: bKey }, { cookie: b.session }), deps(), slug))).toEqual(back('not-owner'));
    expect((await getCircleForMember(db, a.id, slug))!.myRole).toBe('owner');
  });

  it('transfer, leave, remove and close follow through with plain outcome codes', async () => {
    const a = await account();
    const b = await account();
    const c = await account();
    const slug = await created(a.session);
    await join(slug, b.id);
    await join(slug, c.id, 'Cy');
    const back = (code: string) => [303, `/circles/${slug}/?r=${code}#result`];
    expect(where(await leaveCircleRequest(post({}, { cookie: a.session }), deps(), slug))).toEqual(back('owner-leave'));
    const bKey = await keyOf(slug, a.id, 'Bea');
    expect(where(await transferRequest(post({ confirm: 'on', to_member: bKey }, { cookie: a.session }), deps(), slug))).toEqual(back('transferred'));
    expect(where(await leaveCircleRequest(post({}, { cookie: a.session }), deps(), slug))).toEqual([303, '/circles/?r=left#result']);
    const cKey = await keyOf(slug, b.id, 'Cy');
    expect(where(await removeMemberRequest(post({ confirm: 'on', member_key: cKey }, { cookie: b.session }), deps(), slug))).toEqual(back('removed'));
    expect(where(await closeCircleRequest(post({ confirm: 'on' }, { cookie: b.session }), deps(), slug))).toEqual(back('closed'));
  });

  it('a raw account id posted to remove or transfer no longer works (4A review)', async () => {
    const a = await account();
    const b = await account();
    const slug = await created(a.session);
    await join(slug, b.id);
    const back = (code: string) => [303, `/circles/${slug}/?r=${code}#result`];
    const raw = { confirm: 'on', member_account: b.id, member_key: b.id, to_account: b.id, to_member: b.id };
    expect(where(await removeMemberRequest(post(raw, { cookie: a.session }), deps(), slug))).toEqual(back('member-gone'));
    expect(where(await transferRequest(post(raw, { cookie: a.session }), deps(), slug))).toEqual(back('not-eligible'));
    expect((await getCircleForMember(db, a.id, slug))!.myRole).toBe('owner');
  });

  it('a closed circle refuses leaving, for members and the owner alike (4A review)', async () => {
    const a = await account();
    const b = await account();
    const slug = await created(a.session);
    await join(slug, b.id);
    await closeCircleRequest(post({ confirm: 'on' }, { cookie: a.session }), deps(), slug);
    const back = (code: string) => [303, `/circles/${slug}/?r=${code}#result`];
    expect(where(await leaveCircleRequest(post({}, { cookie: b.session }), deps(), slug))).toEqual(back('read-only'));
    expect(where(await leaveCircleRequest(post({}, { cookie: a.session }), deps(), slug))).toEqual(back('read-only'));
  });

  it('a profile id in upper case still names the profile (ids are lower-cased at the boundary)', async () => {
    const a = await account();
    const slug = await created(a.session);
    const mia = await profile(a.id);
    const back = (code: string) => [303, `/circles/${slug}/?r=${code}#result`];
    expect(where(await addChildRequest(post({ profile_id: mia.toUpperCase(), confirm: 'on' }, { cookie: a.session }), deps(), slug))).toEqual(back('child-added'));
    expect(where(await removeChildRequest(post({ profile_id: mia.toUpperCase() }, { cookie: a.session }), deps(), slug))).toEqual(back('child-removed'));
  });

  it("adds the adult's own child with the confirmation only, and removes it", async () => {
    const a = await account();
    const b = await account();
    const slug = await created(a.session);
    await join(slug, b.id);
    const mia = await profile(a.id);
    const back = (code: string) => [303, `/circles/${slug}/?r=${code}#result`];
    expect(where(await addChildRequest(post({ profile_id: mia }, { cookie: a.session }), deps(), slug))).toEqual(back('child-invalid'));
    expect(where(await addChildRequest(post({ profile_id: mia, confirm: 'on' }, { cookie: b.session }), deps(), slug))).toEqual(back('child-no'));
    expect(where(await addChildRequest(post({ profile_id: mia, confirm: 'on' }, { cookie: a.session }), deps(), slug))).toEqual(back('child-added'));
    expect(where(await removeChildRequest(post({ profile_id: mia }, { cookie: b.session }), deps(), slug))).toEqual(back('child-gone'));
    expect(where(await removeChildRequest(post({ profile_id: mia }, { cookie: a.session }), deps(), slug))).toEqual(back('child-removed'));
  });
});

describe('loadCirclePage', () => {
  it('a member gets the view with their own children to add; others get not_found or sign_in; no email anywhere', async () => {
    const a = await account();
    const b = await account();
    const s = await account();
    const slug = await created(a.session);
    await join(slug, b.id);
    const mia = await profile(a.id);
    const page = await loadCirclePage(db, a.session, slug, NOW);
    expect(page.status).toBe('ok');
    if (page.status !== 'ok') return;
    expect(page.view.members.map((m) => m.name)).toEqual(['Mum', 'Bea']);
    expect(page.children).toEqual([{ id: mia, displayName: 'Mia' }]);
    const text = JSON.stringify(page);
    for (const e of [a.email, b.email, '@']) expect(text).not.toContain(e);
    const theirs = await loadCirclePage(db, b.session, slug, NOW);
    expect(theirs.status === 'ok' && theirs.children).toEqual([]);
    expect(await loadCirclePage(db, s.session, slug, NOW)).toEqual({ status: 'not_found' });
    expect(await loadCirclePage(db, a.session, 'zzzzzzzzzz', NOW)).toEqual({ status: 'not_found' });
    expect(await loadCirclePage(db, '', slug, NOW)).toEqual({ status: 'sign_in' });
  });
});
