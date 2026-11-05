// @vitest-environment node
// The invite web layer (plan 4B Task 2): the invite page loader and its metadata, the accept, invite and community
// POSTs, and the invite return path carried through sign-up and sign-in.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import nextConfig from '../../next.config';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { createChildProfile } from '@/lib/accounts/children';
import { switchToProfile } from '@/lib/accounts/context';
import { createAccountLinkLimits, createConfirmLimits, createSendBudget, createSignUpLimits } from '@/lib/accounts/limits';
import { confirmAccountLink, submitSignUp } from '@/lib/accounts/web';
import type { EmailMessage } from '@/lib/email';
import { createCircle, getCircleForMember } from '@/lib/circles/repo';
import { createLinkInvite, type InviteMail } from '@/lib/circles/invites';
import { inviteEmail } from '@/lib/circles/invite-email';
import {
  INVITE_COOKIE,
  acceptInviteRequest,
  createLinkRequest,
  emailInviteRequest,
  inviteMetadata,
  joinCommunityRequest,
  loadInvitePage,
  revokeInviteRequest,
} from '@/lib/circles/invite-web';

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
  const headers: Record<string, string> = { ...HEAD, 'x-forwarded-for': '192.0.2.9' };
  if (opts.origin === null) delete headers.origin;
  else if (opts.origin) headers.origin = opts.origin;
  if (opts.cookie) headers.cookie = `__Host-sk_account=${opts.cookie}`;
  return new Request('http://localhost/x', { method: 'POST', headers, body: new URLSearchParams(body).toString() });
};
const sent: InviteMail[] = [];
const deps = (over: Record<string, unknown> = {}) => ({
  db,
  now: NOW,
  limit: () => true,
  network: () => true,
  send: async (m: InviteMail) => void sent.push(m),
  ...over,
});
const where = (r: Response) => [r.status, r.headers.get('location')];

async function account(dateOfBirth = '1990-05-05') {
  const email = `iweb${n++}@example.test`;
  const parentEmail = dateOfBirth.startsWith('2012') ? `p${n++}@example.test` : undefined;
  const r = await signUp(db, { email, dateOfBirth, parentEmail }, NOW);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, NOW))!, NOW))!;
  return { id: r.accountId, email, session };
}
async function circle(ownerId: string, kind = 'friends', name = 'Night Owls') {
  const r = await createCircle(db, ownerId, { name, kind, yourName: 'Olly Owner' }, NOW);
  if (r.status !== 'created') throw new Error('create failed');
  return r.slug;
}
async function token(ownerId: string, slug: string) {
  const r = await createLinkInvite(db, ownerId, slug, NOW);
  if (r.status !== 'created') throw new Error('link failed');
  return r.token;
}
const inviteRow = async () => (await db.query('SELECT revoked_at, used_at, used_by FROM circle_invites ORDER BY created_at')).rows;

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM circles');
  await db.query('DELETE FROM accounts');
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('CIRCLES_ENABLED', 'true');
  sent.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('flags', () => {
  it('with either flag off every invite route is a 404 and the page loader finds nothing', async () => {
    const a = await account();
    const slug = await circle(a.id);
    const t = await token(a.id, slug);
    for (const [accounts, circles] of [['true', ''], ['', 'true']]) {
      vi.stubEnv('ACCOUNTS_ENABLED', accounts);
      vi.stubEnv('CIRCLES_ENABLED', circles);
      const p = post({ your_name: 'X', email: 'x@example.test', slug }, { cookie: a.session });
      expect((await acceptInviteRequest(p.clone(), deps(), t)).status).toBe(404);
      expect((await createLinkRequest(p.clone(), deps(), slug)).status).toBe(404);
      expect((await emailInviteRequest(p.clone(), deps(), slug)).status).toBe(404);
      expect((await revokeInviteRequest(p.clone(), deps(), slug)).status).toBe(404);
      expect((await joinCommunityRequest(p.clone(), deps())).status).toBe(404);
      expect(await loadInvitePage(db, a.session, t, NOW)).toEqual({ status: 'not_found' });
    }
  });
});

describe('the invite page', () => {
  it('shows the circle name, kind and member count to anyone, and a GET never uses or revokes the invite', async () => {
    const a = await account();
    const slug = await circle(a.id);
    const t = await token(a.id, slug);
    const before = await inviteRow();
    const b = await account();
    for (const s of ['', b.session, b.session]) {
      const page = await loadInvitePage(db, s, t, NOW);
      expect(page).toMatchObject({
        status: 'ok',
        preview: { circleName: 'Night Owls', kind: 'friends', memberCount: 1 },
        viewer: s ? 'adult' : 'anonymous',
        next: `/circles/join/${t}/`,
      });
      expect(JSON.stringify(page)).not.toMatch(/Olly|example\.test/);
    }
    expect(await inviteRow()).toEqual(before);
    expect((await db.query<{ opens: number }>('SELECT opens FROM circle_invites')).rows[0].opens).toBe(3);
    expect(await getCircleForMember(db, b.id, slug)).toBeNull();
  });

  it('says child for a child context', async () => {
    const a = await account();
    const t = await token(a.id, await circle(a.id));
    const kid = await createChildProfile(db, a.id, { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, NOW);
    if (kid.status !== 'created') throw new Error('profile');
    await switchToProfile(db, a.session, kid.profileId, NOW);
    expect(await loadInvitePage(db, a.session, t, NOW)).toMatchObject({ status: 'ok', viewer: 'child' });
  });

  it('is the same not_found for an unknown, malformed, revoked or closed-circle token', async () => {
    const a = await account();
    const slug = await circle(a.id);
    const old = await token(a.id, slug);
    await token(a.id, slug);
    for (const t of [old, 'A'.repeat(43), 'short', '../x']) {
      expect(await loadInvitePage(db, '', t, NOW)).toEqual({ status: 'not_found' });
    }
  });

  it('metadata: the title names the circle, one branded image, no personal data, no referrer', () => {
    const m = inviteMetadata({ circleName: 'Night Owls', kind: 'friends', memberCount: 4 });
    expect(String(m.title)).toContain('Night Owls');
    expect(m.openGraph).toMatchObject({ title: expect.stringContaining('Night Owls'), images: ['/circles/invite-image/'] });
    expect(m.referrer).toBe('no-referrer');
    expect(m.robots).toMatchObject({ index: false });
    expect(JSON.stringify(m)).not.toMatch(/@|Olly/);
    const none = inviteMetadata(null);
    expect(JSON.stringify(none)).not.toContain('Night Owls');
    expect(none.referrer).toBe('no-referrer');
  });

  it('next.config sends no-store and no-referrer for every invite page', async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source === '/circles/join/:path*');
    expect(rule?.headers).toEqual(
      expect.arrayContaining([
        { key: 'Cache-Control', value: 'no-store' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ]),
    );
  });
});

describe('accepting', () => {
  it('needs the same origin, sends anonymous visitors to sign-up with only the validated path, refuses a child', async () => {
    const a = await account();
    const t = await token(a.id, await circle(a.id));
    expect((await acceptInviteRequest(post({ your_name: 'Bea' }, { origin: null }), deps(), t)).status).toBe(403);
    expect((await acceptInviteRequest(post({ your_name: 'Bea' }, { origin: 'https://evil.example' }), deps(), t)).status).toBe(403);
    expect(where(await acceptInviteRequest(post({ your_name: 'Bea' }), deps(), t))).toEqual([
      303,
      `/account/sign-up/?next=${encodeURIComponent(`/circles/join/${t}/`)}`,
    ]);
    expect(where(await acceptInviteRequest(post({ your_name: 'Bea' }), deps(), '//evil.example'))).toEqual([303, '/account/sign-up/']);
    const kid = await createChildProfile(db, a.id, { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, NOW);
    if (kid.status !== 'created') throw new Error('profile');
    await switchToProfile(db, a.session, kid.profileId, NOW);
    expect((await acceptInviteRequest(post({ your_name: 'Mia' }, { cookie: a.session }), deps(), t)).status).toBe(403);
  });

  it('accepts the opaque Origin the no-referrer invite page makes a browser send, only with Sec-Fetch-Site same-origin', async () => {
    const a = await account();
    const slug = await circle(a.id);
    const t = await token(a.id, slug);
    const b = await account();
    const from = (site: string | null) => {
      const r = post({ your_name: 'Bea' }, { cookie: b.session, origin: 'null' });
      if (site) r.headers.set('sec-fetch-site', site);
      return r;
    };
    expect((await acceptInviteRequest(from(null), deps(), t)).status).toBe(403);
    expect((await acceptInviteRequest(from('cross-site'), deps(), t)).status).toBe(403);
    expect((await acceptInviteRequest(from('same-site'), deps(), t)).status).toBe(403);
    expect(where(await acceptInviteRequest(from('same-origin'), deps(), t))).toEqual([303, `/circles/${slug}/?r=joined#result`]);
  });

  it('is limited per network (429)', async () => {
    const a = await account();
    const t = await token(a.id, await circle(a.id));
    const b = await account();
    expect((await acceptInviteRequest(post({ your_name: 'Bea' }, { cookie: b.session }), deps({ network: () => false }), t)).status).toBe(429);
  });

  it('joins the circle the token names, whatever circle the form names', async () => {
    const a = await account();
    const slug = await circle(a.id);
    const other = await circle(a.id, 'friends', 'Other');
    const t = await token(a.id, slug);
    const b = await account();
    const r = await acceptInviteRequest(post({ your_name: 'Bea', circle: other, slug: other }, { cookie: b.session }), deps(), t);
    expect(where(r)).toEqual([303, `/circles/${slug}/?r=joined#result`]);
    expect(await getCircleForMember(db, b.id, other)).toBeNull();
    expect((await getCircleForMember(db, b.id, slug))!.members.map((m) => m.name)).toContain('Bea');
    expect(where(await acceptInviteRequest(post({ your_name: 'Bea' }, { cookie: b.session }), deps(), t))).toEqual([
      303,
      `/circles/join/${t}/?r=already_member#result`,
    ]);
  });

  it('a bad name goes back to the page; an unknown token is a plain 404', async () => {
    const a = await account();
    const t = await token(a.id, await circle(a.id));
    const b = await account();
    expect(where(await acceptInviteRequest(post({ your_name: '' }, { cookie: b.session }), deps(), t))).toEqual([
      303,
      `/circles/join/${t}/?r=name#result`,
    ]);
    const res = await acceptInviteRequest(post({ your_name: 'Bea' }, { cookie: b.session }), deps(), 'B'.repeat(43));
    expect(res.status).toBe(404);
  });
});

describe('making and revoking invites', () => {
  it('a link invite comes back once through a short-lived cookie; a forged circle field is ignored', async () => {
    const a = await account();
    const slug = await circle(a.id);
    const other = await circle((await account()).id, 'friends', 'Theirs');
    const r = await createLinkRequest(post({ circle: other, slug: other }, { cookie: a.session }), deps(), slug);
    expect(where(r)).toEqual([303, `/circles/${slug}/?r=link#invites`]);
    const cookie = r.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(new RegExp(`^${INVITE_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$`));
    const rows = (await db.query<{ slug: string }>('SELECT c.slug FROM circle_invites i JOIN circles c ON c.id = i.circle_id')).rows;
    expect(rows).toEqual([{ slug }]);
  });

  it('needs an adult context and membership; a stranger gets the neutral answer', async () => {
    const a = await account();
    const slug = await circle(a.id);
    const s = await account();
    expect(where(await createLinkRequest(post({}, { cookie: s.session }), deps(), slug))).toEqual([303, '/circles/?r=gone#result']);
    expect(where(await emailInviteRequest(post({ email: 'x@example.test' }, { cookie: s.session }), deps(), slug))).toEqual([
      303,
      '/circles/?r=gone#result',
    ]);
    expect((await createLinkRequest(post({}), deps(), slug)).status).toBe(303);
    expect((await createLinkRequest(post({}, { cookie: a.session, origin: null }), deps(), slug)).status).toBe(403);
    const kid = await createChildProfile(db, a.id, { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, NOW);
    if (kid.status !== 'created') throw new Error('profile');
    await switchToProfile(db, a.session, kid.profileId, NOW);
    for (const fn of [createLinkRequest, emailInviteRequest, revokeInviteRequest]) {
      expect((await fn(post({ email: 'x@example.test' }, { cookie: a.session }), deps(), slug)).status).toBe(403);
    }
    expect(await inviteRow()).toEqual([]);
  });

  it('email invites go through the injected sender with plain outcome codes, limited per network', async () => {
    const a = await account();
    const slug = await circle(a.id);
    const back = (code: string) => [303, `/circles/${slug}/?r=${code}#invites`];
    expect(where(await emailInviteRequest(post({ email: 'f@example.test' }, { cookie: a.session }), deps(), slug))).toEqual(back('email-sent'));
    expect(sent.map((m) => m.to)).toEqual(['f@example.test']);
    expect(where(await emailInviteRequest(post({ email: 'f@example.test' }, { cookie: a.session }), deps(), slug))).toEqual(back('email-duplicate'));
    expect(where(await emailInviteRequest(post({ email: 'nope' }, { cookie: a.session }), deps(), slug))).toEqual(back('email-invalid'));
    expect((await emailInviteRequest(post({ email: 'g@example.test' }, { cookie: a.session }), deps({ network: () => false }), slug)).status).toBe(429);
  });

  it('revoke takes an invite id but only within the URL circle and the caller’s rights', async () => {
    const a = await account();
    const slug = await circle(a.id);
    const b = await account();
    const theirs = await circle(b.id, 'friends', 'Theirs');
    await token(b.id, theirs);
    const id = (await db.query<{ id: string }>('SELECT id FROM circle_invites')).rows[0].id;
    expect(where(await revokeInviteRequest(post({ invite_id: id }, { cookie: a.session }), deps(), slug))).toEqual([
      303,
      `/circles/${slug}/?r=revoke-gone#invites`,
    ]);
    expect((await inviteRow())[0].revoked_at).toBeNull();
    expect(where(await revokeInviteRequest(post({ invite_id: id }, { cookie: b.session }), deps(), theirs))).toEqual([
      303,
      `/circles/${theirs}/?r=revoked#invites`,
    ]);
  });
});

describe('joining a community', () => {
  it('joins by slug from the form, refuses 13-15 with a code, needs an adult context', async () => {
    const a = await account();
    const slug = await circle(a.id, 'community', 'Open Club');
    const b = await account('2010-01-01');
    expect(where(await joinCommunityRequest(post({ slug, your_name: 'Bo' }, { cookie: b.session }), deps()))).toEqual([
      303,
      `/circles/${slug}/?r=joined#result`,
    ]);
    const young = await account('2012-01-01');
    await db.query("UPDATE accounts SET consent_state = 'confirmed' WHERE id = $1", [young.id]);
    expect(where(await joinCommunityRequest(post({ slug, your_name: 'Yo' }, { cookie: young.session }), deps()))).toEqual([
      303,
      '/circles/communities/?r=community_age#result',
    ]);
    expect((await joinCommunityRequest(post({ slug, your_name: 'Yo' }, { cookie: young.session, origin: null }), deps())).status).toBe(403);
    expect(where(await joinCommunityRequest(post({ slug, your_name: 'Yo' }), deps()))).toEqual([303, '/account/sign-in/']);
  });
});

describe('the invite email', () => {
  it('names the inviter by their circle name and the circle, says to ignore it otherwise, and unsubscribes members', () => {
    const m: InviteMail = { to: 'f@example.test', token: 'T'.repeat(43), inviterName: 'Olly', circleName: 'Night Owls', recipientAccountId: null };
    const plain = inviteEmail(m, { joinUrl: 'https://x.test/circles/join/T/', unsubscribeUrl: null });
    expect(plain.subject).toContain('Night Owls');
    expect(plain.text).toContain('Olly');
    expect(plain.text).toContain('https://x.test/circles/join/T/');
    expect(plain.text).toMatch(/ignore this if you do not know them/i);
    expect(plain.text).not.toMatch(/unsubscribe/i);
    const member = inviteEmail(m, { joinUrl: 'https://x.test/j/', unsubscribeUrl: 'https://x.test/account/unsubscribe/?t=abc' });
    expect(member.text).toContain('https://x.test/account/unsubscribe/?t=abc');
  });
});

describe('the invite return path through sign-up and sign-in', () => {
  const t = 'Q'.repeat(43);
  const next = `/circles/join/${t}/`;
  async function run(fn: (d: never) => Promise<Response>, mail: EmailMessage[]) {
    const jobs: Promise<void>[] = [];
    const res = await fn({
      db,
      env: { ADMIN_LINK_BASE: 'https://staging.sparkkindly.com' },
      now: NOW,
      send: async (m: EmailMessage) => void mail.push(m),
      defer: (w: () => Promise<void>) => void jobs.push(w()),
      links: createAccountLinkLimits(() => 0),
      signUps: createSignUpLimits(() => 0),
      confirms: createConfirmLimits(() => 0),
      budget: createSendBudget({ clock: () => 0, warn: () => {} }),
    } as never);
    await Promise.all(jobs);
    return res;
  }

  it('the emailed link carries a valid invite path, and nothing else', async () => {
    for (const [given, carried] of [
      [next, true],
      ['//evil.example/', false],
      ['https://evil.example/', false],
      ['/account/', false],
    ] as const) {
      const mail: EmailMessage[] = [];
      await run((d) => submitSignUp(post({ email: `ret${n++}@example.test`, dob: '1990-05-05', next: given }), d), mail);
      expect(mail).toHaveLength(1);
      expect(mail[0].text.includes(`&next=${encodeURIComponent(next)}`), given).toBe(carried);
      expect(mail[0].text).not.toContain('evil');
    }
  });

  it('confirming the link goes to the invite page only for a valid path', async () => {
    for (const [given, to] of [
      [next, next],
      ['//evil.example/', '/account/'],
      [`https://evil.example${next}`, '/account/'],
    ] as const) {
      const email = `conf${n++}@example.test`;
      await signUp(db, { email, dateOfBirth: '1990-05-05' }, NOW);
      const link = (await requestAccountLink(db, email, {}, NOW))!;
      const res = await run((d) => confirmAccountLink(post({ token: link, next: given }), d), []);
      expect(where(res), given).toEqual([303, to]);
    }
  });
});
