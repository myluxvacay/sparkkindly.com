// @vitest-environment node
// 4B security review fixes: a site-wide cap per invited address and a "never email me invites again" link for addresses
// without an account; no links in circle and member names; the sender's account row locked for the daily cap; leaving
// revokes the leaver's invites; the one-time invite link cookie is cleared; invite mail has its own send budget; and in a
// circle holding a child profile only the owner invites.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { newTestDb } from '../helpers/test-db';
import type { Db, Queryable } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { createSendBudget } from '@/lib/accounts/limits';
import { signOut } from '@/lib/accounts/web';
import { validateCircleInput, cleanMemberName } from '@/lib/circles/rules';
import { createCircle, leaveCircle } from '@/lib/circles/repo';
import { addChildToCircle } from '@/lib/circles/children';
import { acceptInvite, createEmailInvite, createLinkInvite, listInvites, previewInvite, purgeExpiredInvites, type InviteMail } from '@/lib/circles/invites';
import { ADDRESS_LIMITS, addressHash, claimAddressSend, readSuppressToken, suppressToken } from '@/lib/circles/invite-guard';
import { INVITE_COOKIE, clearsFlash } from '@/lib/circles/invite-flash';
import { inviteSender, stopInvitesRequest } from '@/lib/circles/invite-web';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-05T12:00:00Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const SECRET = 'test-only-unsubscribe-secret-0123456789abcdef';
const ENV = { UNSUBSCRIBE_SECRET: SECRET, ADMIN_LINK_BASE: 'https://staging.sparkkindly.com' };
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM circles');
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM invite_address_log');
  await db.query('DELETE FROM invite_suppressions');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function account(email = `guard${n++}@example.test`) {
  const r = await signUp(db, { email, dateOfBirth: '1990-05-05' }, NOW);
  if (r.status !== 'created') throw new Error('sign-up failed');
  return r.accountId;
}
async function circle(owner: string, kind = 'family') {
  const r = await createCircle(db, owner, { name: 'Home', kind, yourName: 'Olly' }, NOW);
  if (r.status !== 'created') throw new Error(`create failed: ${r.status}`);
  return r.slug;
}
const addMember = (slug: string, accountId: string, name = 'Mo') =>
  db.query('INSERT INTO circle_members (circle_id, account_id, display_name) SELECT id, $2, $3 FROM circles WHERE slug = $1', [slug, accountId, name]);
async function childIn(accountId: string, slug: string) {
  const p = await db.query<{ id: string }>("INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, 'Mia', '6-9') RETURNING id", [accountId]);
  expect(await addChildToCircle(db, accountId, slug, p.rows[0].id, 'on', NOW)).toBe('added');
}
const mail = (to: string, recipientAccountId: string | null = null): InviteMail => ({ to, token: 'T'.repeat(43), inviterName: 'Olly', circleName: 'Home', recipientAccountId });

describe('1(c) names and descriptions carry no links', () => {
  it('rejects a scheme, www. or a domain-like word in circle names, descriptions and member names', () => {
    for (const bad of ['http://x', 'see https://evil.example', 'www.evil', 'evil.com', 'win at prizes.io now', 'HTTPS://X']) {
      expect(validateCircleInput({ name: bad, kind: 'friends', yourName: 'Sam' }).ok, bad).toBe(false);
      expect(validateCircleInput({ name: 'Club', kind: 'community', yourName: 'Sam', description: bad }).ok, bad).toBe(false);
      expect(cleanMemberName(bad), bad).toBeNull();
    }
    for (const good of ['St. Mary Quiz', 'The Rivera Home', 'Mum', 'Quiz night 2.0']) {
      expect(validateCircleInput({ name: good, kind: 'friends', yourName: 'Sam' }).ok, good).toBe(true);
    }
  });
});

describe('1(a) a site-wide cap per invited address', () => {
  it('hashes the lower-cased address under a distinct label; no secret, no hash', () => {
    const h = addressHash(SECRET, 'Someone@Example.test');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(addressHash(SECRET, 'someone@example.test')).toBe(h);
    expect(addressHash(SECRET, 'other@example.test')).not.toBe(h);
    expect(addressHash('', 'someone@example.test')).toBeNull();
    expect(addressHash('short', 'someone@example.test')).toBeNull();
  });

  it('allows 3 sends to one address in a rolling 7 days across all circles and senders, and prunes after 8 days', async () => {
    const h = addressHash(SECRET, 'target@example.test')!;
    for (let i = 0; i < ADDRESS_LIMITS.perWeek; i++) expect(await claimAddressSend(db, h, at(i))).toBe(true);
    expect(await claimAddressSend(db, h, at(3))).toBe(false);
    expect(await claimAddressSend(db, addressHash(SECRET, 'else@example.test')!, at(3))).toBe(true);
    expect(await claimAddressSend(db, h, at(7.01))).toBe(true);
    await purgeExpiredInvites(db, at(20));
    expect((await db.query('SELECT count(*)::int AS n FROM invite_address_log')).rows[0].n).toBe(0);
  });

  it('the production sender mails at most 3 times per address, whoever sends, and nothing without the secret', async () => {
    const out: EmailMessage[] = [];
    const sender = inviteSender(ENV, async (m) => void out.push(m), db, () => true, () => NOW);
    for (let i = 0; i < 5; i++) await sender(mail('target@example.test'));
    expect(out).toHaveLength(3);
    const quiet = inviteSender({ ADMIN_LINK_BASE: 'https://x.test' }, async (m) => void out.push(m), db, () => true, () => NOW);
    await quiet(mail('fresh@example.test'));
    expect(out).toHaveLength(3);
  });
});

describe('1(b) never email me invites again', () => {
  it('a mail to an address without an account carries a stop link; with an account, the account unsubscribe instead', async () => {
    const out: EmailMessage[] = [];
    const sender = inviteSender(ENV, async (m) => void out.push(m), db, () => true, () => NOW);
    await sender(mail('nobody@example.test'));
    const id = await account('member@example.test');
    await sender(mail('member@example.test', id));
    expect(out[0].text).toMatch(/https:\/\/staging\.sparkkindly\.com\/circles\/stop-invites\/\?t=[0-9a-f]{64}\.[A-Za-z0-9_-]{43}/);
    expect(out[1].text).not.toContain('/circles/stop-invites/');
    expect(out[1].text).toContain('/account/unsubscribe/');
  });

  it('the stop token is bound to the address hash and the secret', () => {
    const h = addressHash(SECRET, 'nobody@example.test')!;
    const t = suppressToken(SECRET, h)!;
    expect(readSuppressToken(SECRET, t)).toBe(h);
    expect(readSuppressToken('another-secret-of-enough-length-0123456789', t)).toBeNull();
    expect(readSuppressToken(SECRET, `${addressHash(SECRET, 'x@example.test')}.${t.split('.')[1]}`)).toBeNull();
    expect(readSuppressToken(SECRET, 'garbage')).toBeNull();
    expect(suppressToken('', h)).toBeNull();
  });

  it('the stop page is never cached and sends no Referer', async () => {
    const rules = await (await import('../../next.config')).default.headers!();
    expect(rules.find((r) => r.source === '/circles/stop-invites/:path*')?.headers).toEqual([
      { key: 'Cache-Control', value: 'no-store' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
    ]);
  });

  it('the POST suppresses the address (no sign-in, no Origin needed); suppressed addresses get nothing more', async () => {
    const h = addressHash(SECRET, 'nobody@example.test')!;
    const t = suppressToken(SECRET, h)!;
    const req = (body: string) =>
      new Request('http://localhost/circles/stop-invites/confirm/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    const r = await stopInvitesRequest(req(`t=${t}`), { db, env: ENV, limits: () => true });
    expect([r.status, r.headers.get('location')]).toEqual([303, '/circles/stop-invites/?r=done#result']);
    const bad = await stopInvitesRequest(req('t=forged'), { db, env: ENV, limits: () => true });
    expect([bad.status, bad.headers.get('location')]).toEqual([303, '/circles/stop-invites/?r=done#result']);
    expect((await stopInvitesRequest(req('t=forged'), { db, env: ENV, limits: () => false })).status).toBe(429);
    expect((await db.query('SELECT addr_hash FROM invite_suppressions')).rows).toEqual([{ addr_hash: h }]);
    const out: EmailMessage[] = [];
    await inviteSender(ENV, async (m) => void out.push(m), db, () => true, () => NOW)(mail('NOBODY@example.test'));
    expect(out).toEqual([]);
  });
});

describe('3 the daily email cap locks the sender account row', () => {
  it('the email path locks the circle, then the account FOR UPDATE; concurrent sends across circles stay within 10', async () => {
    const sender = await account();
    const slugs: string[] = [];
    for (let i = 0; i < 12; i++) {
      const owner = await account();
      const slug = await circle(owner, 'friends');
      await addMember(slug, sender);
      slugs.push(slug);
    }
    const seen: string[] = [];
    const recording: Db = {
      query: (t, p) => db.query(t, p),
      transaction: (fn) =>
        db.transaction((tx) =>
          fn({
            query: (t: string, p?: unknown[]) => {
              seen.push(t);
              return tx.query(t, p);
            },
          } as Queryable),
        ),
    } as Db;
    const results = await Promise.all(
      slugs.map((s, i) => createEmailInvite(recording, sender, s, `x${i}@example.test`, NOW, async () => undefined)),
    );
    expect(results.filter((r) => r === 'sent')).toHaveLength(10);
    expect(results.filter((r) => r === 'limit')).toHaveLength(2);
    const circleLock = seen.findIndex((t) => /FROM circles WHERE slug = \$1 FOR UPDATE/.test(t));
    const accountLock = seen.findIndex((t) => /FOR UPDATE OF a/.test(t));
    expect(circleLock).toBeGreaterThanOrEqual(0);
    expect(accountLock).toBeGreaterThan(circleLock);
  });
});

describe('4 leaving revokes the leaver’s invites', () => {
  it('link, leave, rejoin through another invite: the old link stays invalid', async () => {
    const owner = await account();
    const mo = await account();
    const slug = await circle(owner, 'friends');
    await addMember(slug, mo);
    const old = await createLinkInvite(db, mo, slug, NOW);
    if (old.status !== 'created') throw new Error('link');
    expect(await leaveCircle(db, mo, slug, NOW)).toBe('left');
    const ownerLink = await createLinkInvite(db, owner, slug, NOW);
    if (ownerLink.status !== 'created') throw new Error('link');
    expect(await acceptInvite(db, mo, ownerLink.token, 'Mo again', NOW)).toMatchObject({ status: 'joined' });
    expect(await previewInvite(db, old.token, NOW)).toBeNull();
    const row = await db.query<{ revoked_at: Date | null }>("SELECT revoked_at FROM circle_invites WHERE created_by = $1", [mo]);
    expect(row.rows[0].revoked_at).not.toBeNull();
  });
});

describe('5 the one-time invite link cookie', () => {
  const get = (path: string, headers: Record<string, string> = {}) => ({ method: 'GET', pathname: path, headers: new Headers(headers) });
  const withCookie = { cookie: `${INVITE_COOKIE}=abc` };

  it('is cleared by the first plain GET of a circle page that carries it, never by a prefetch or another page', () => {
    expect(clearsFlash(get('/circles/abcdefghij/', withCookie))).toBe(true);
    expect(clearsFlash(get('/circles/abcdefghij', withCookie))).toBe(true);
    expect(clearsFlash(get('/circles/abcdefghij/'))).toBe(false);
    expect(clearsFlash(get('/circles/abcdefghij/set/', withCookie))).toBe(false);
    expect(clearsFlash(get('/circles/', withCookie))).toBe(false);
    expect(clearsFlash({ ...get('/circles/abcdefghij/', withCookie), method: 'POST' })).toBe(false);
    expect(clearsFlash(get('/circles/abcdefghij/', { ...withCookie, 'next-router-prefetch': '1' }))).toBe(false);
    expect(clearsFlash(get('/circles/abcdefghij/', { ...withCookie, purpose: 'prefetch' }))).toBe(false);
  });

  it('the proxy sends the clearing cookie on that response', async () => {
    const { proxy } = await import('../../proxy');
    const { NextRequest } = await import('next/server');
    const res = proxy(new NextRequest('https://staging.sparkkindly.com/circles/abcdefghij/', { headers: withCookie }));
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`^${INVITE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`));
    const other = proxy(new NextRequest('https://staging.sparkkindly.com/circles/abcdefghij/', {}));
    expect(other.headers.get('set-cookie')).toBeNull();
  });

  it('signing out clears it too', async () => {
    const email = `out${n++}@example.test`;
    await signUp(db, { email, dateOfBirth: '1990-05-05' }, NOW);
    const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, NOW))!, NOW))!;
    const r = await signOut(
      new Request('http://localhost/account/sign-out/', {
        method: 'POST',
        headers: { host: 'staging.sparkkindly.com', origin: 'https://staging.sparkkindly.com', cookie: `__Host-sk_account=${session}` },
      }),
      { db, env: {}, now: NOW } as never,
    );
    expect(r.status).toBe(303);
    const cookies = r.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith(`${INVITE_COOKIE}=;`) && c.includes('Max-Age=0'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('__Host-sk_account=;'))).toBe(true);
  });
});

describe('6 invite mail has its own send budget', () => {
  it('exhausting the invite budget skips invite mail and leaves the account budget untouched', async () => {
    const inviteBudget = createSendBudget({ perHour: 2, warn: () => {} });
    const accountBudget = createSendBudget({ perHour: 2, warn: () => {} });
    const out: EmailMessage[] = [];
    const sender = inviteSender(ENV, async (m) => void out.push(m), db, inviteBudget, () => NOW);
    for (let i = 0; i < 4; i++) await sender(mail(`b${i}@example.test`));
    expect(out).toHaveLength(2);
    expect([accountBudget(), accountBudget()]).toEqual([true, true]);
  });

  it('the default invite budget is a separate 60-an-hour counter', () => {
    const src = readFileSync('lib/accounts/limits.ts', 'utf8');
    expect(src).toMatch(/inviteSendBudget = \(shared\.__sparkInviteSendBudget \?\?= createSendBudget\(\{ perHour: 60/);
    expect(readFileSync('lib/circles/invite-web.ts', 'utf8')).toMatch(/budget = inviteSendBudget/);
  });
});

describe('7 ruling: in a circle holding a child profile only the owner invites', () => {
  it('a member cannot make a link or an email invite, the owner can; a member link made earlier stops working', async () => {
    const owner = await account();
    const mo = await account();
    const slug = await circle(owner, 'family');
    await addMember(slug, mo);
    const early = await createLinkInvite(db, mo, slug, NOW);
    if (early.status !== 'created') throw new Error('link');
    await childIn(owner, slug);
    expect(await previewInvite(db, early.token, NOW)).toBeNull();
    expect(await createLinkInvite(db, mo, slug, NOW)).toEqual({ status: 'not_allowed' });
    expect(await createEmailInvite(db, mo, slug, 'x@example.test', NOW, async () => undefined)).toBe('not_allowed');
    expect((await listInvites(db, mo, slug, NOW, null))!.canInvite).toBe(false);
    expect((await createLinkInvite(db, owner, slug, NOW)).status).toBe('created');
    expect((await listInvites(db, owner, slug, NOW, null))!.canInvite).toBe(true);
  });
});

describe('2 Caddy leaves the app Referrer-Policy alone', () => {
  it('both site blocks set Referrer-Policy only when the app sent none', () => {
    for (const f of ['deploy/caddy/sparkkindly-public-app.caddy', 'deploy/caddy/sparkkindly-staging.caddy']) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).toMatch(/^\s*\?Referrer-Policy "strict-origin-when-cross-origin"$/m);
      expect(text, f).not.toMatch(/^\s*Referrer-Policy /m);
    }
  });
});
