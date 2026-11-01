// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { newTotpSecret, totpAt } from '@/lib/admin/totp';
import { createCodeLimits, createSignInLimits } from '@/lib/admin/guard';
import { csrfToken, getAdmin } from '@/lib/admin/sessions';
import { requestSignIn, confirmLink, submitSignInCode } from '@/lib/admin/sign-in';
import type { EmailMessage } from '@/lib/email';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let secret: string;
const OWNER = 'owner@example.test';
const env = { ADMIN_EMAILS: OWNER, ADMIN_LINK_BASE: 'https://staging.sparkkindly.com' };
const NOW = new Date('2026-11-01T09:00:00Z');
const ORIGIN = { host: 'staging.sparkkindly.com', origin: 'https://staging.sparkkindly.com' };
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

const post = (path: string, body: Record<string, string>, headers: Record<string, string> = ORIGIN) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers: { ...FORM, ...headers }, body: new URLSearchParams(body).toString() });

function deps(sent: EmailMessage[] = [], now = NOW) {
  return {
    db,
    env,
    now,
    send: vi.fn(async (m: EmailMessage) => { sent.push(m); return {}; }),
    limits: createSignInLimits(() => 0),
    codes: createCodeLimits(() => 0),
    pending: new Map<string, string>(),
  };
}
const cookieValue = (r: Response) => /__Host-sk_admin=([^;]*)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';
const auditCount = async (action: string) =>
  Number((await db.query<{ n: string }>('SELECT count(*) n FROM audit_log WHERE action = $1', [action])).rows[0].n);

beforeAll(async () => {
  db = await newTestDb();
  secret = newTotpSecret();
  await db.query('INSERT INTO admin_users (email, totp_secret) VALUES ($1, $2)', [OWNER, secret]);
});
afterAll(async () => {
  await db.close();
});

async function linkToken(): Promise<string> {
  const sent: EmailMessage[] = [];
  await requestSignIn(post('/admin/sign-in/request/', { email: OWNER }), deps(sent));
  return /token=([0-9a-f]{64})/.exec(sent[0].text)![1];
}

describe('requestSignIn', () => {
  it('answers allowed and unknown addresses the same way, emails only the allowed one, and never shows the token', async () => {
    const sent: EmailMessage[] = [];
    const a = await requestSignIn(post('/admin/sign-in/request/', { email: 'Owner@Example.test' }), deps(sent));
    const b = await requestSignIn(post('/admin/sign-in/request/', { email: 'stranger@example.test' }), deps(sent));
    expect([a.status, b.status]).toEqual([303, 303]);
    expect(a.headers.get('location')).toBe(b.headers.get('location'));
    expect(await a.text()).toBe('');
    expect(a.headers.get('set-cookie')).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(OWNER);
    expect(sent[0].text).toMatch(/^Use this link/);
    expect(sent[0].text).toContain('https://staging.sparkkindly.com/admin/sign-in/link/?token=');
    const token = /token=([0-9a-f]{64})/.exec(sent[0].text)![1];
    const audits = JSON.stringify((await db.query('SELECT * FROM audit_log')).rows);
    expect(audits).not.toContain(token);
  });

  it('builds the link from configuration, never from the Host header', async () => {
    const sent: EmailMessage[] = [];
    await requestSignIn(post('/admin/sign-in/request/', { email: OWNER }, { host: 'evil.example', origin: 'https://evil.example' }), deps(sent));
    expect(sent[0].text).not.toContain('evil.example');
  });

  it('refuses a request with no Origin or a foreign one', async () => {
    const sent: EmailMessage[] = [];
    expect((await requestSignIn(post('/admin/sign-in/request/', { email: OWNER }, { host: 'x' }), deps(sent))).status).toBe(403);
    expect((await requestSignIn(post('/admin/sign-in/request/', { email: OWNER }, { host: 'a.test', origin: 'https://b.test' }), deps(sent))).status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('a limited request gets the same answer as any other but sends nothing', async () => {
    const sent: EmailMessage[] = [];
    const d = deps(sent);
    const from = { ...ORIGIN, 'x-forwarded-for': '9.9.9.9' };
    const answers = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const r = await requestSignIn(post('/admin/sign-in/request/', { email: `x${i}@example.test` }, from), d);
      answers.add(`${r.status} ${r.headers.get('location')}`);
    }
    const limited = await requestSignIn(post('/admin/sign-in/request/', { email: OWNER }, from), d);
    answers.add(`${limited.status} ${limited.headers.get('location')}`);
    expect([...answers]).toEqual(['303 /admin/sign-in/?sent=1']);
    expect(sent).toHaveLength(0);
  });

  it('over the new-link cap, the pending link is re-sent instead of minted, so a flood delays nothing and sends stay bounded', async () => {
    const sent: EmailMessage[] = [];
    const d = deps(sent);
    for (let c = 0; c < 40; c++) {
      await requestSignIn(post('/admin/sign-in/request/', { email: `junk${c}@example.test` }, { ...ORIGIN, 'x-forwarded-for': `10.0.0.${c}` }), d);
      await requestSignIn(post('/admin/sign-in/request/', { email: OWNER }, { ...ORIGIN, 'x-forwarded-for': `10.9.${c}.9` }), d);
    }
    expect(sent.length).toBe(4); // three new links, then one re-send of the last pending link
    const tokens = sent.map((m) => /token=([0-9a-f]{64})/.exec(m.text)![1]);
    expect(new Set(tokens).size).toBe(3);
    expect(tokens[3]).toBe(tokens[2]);
    const r = await requestSignIn(post('/admin/sign-in/request/', { email: OWNER }, { ...ORIGIN, 'x-forwarded-for': '203.0.113.5' }), d);
    expect(r.status).toBe(303);
    // The owner's inbox already holds a link that still works (the flood could only delay it, never block it).
    const session = await confirmLink(post('/admin/sign-in/link/confirm/', { token: tokens[3] }), deps());
    expect(session.headers.get('location')).toBe('/admin/sign-in/code/');
  });

  it('survives a failing mail send without leaking it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = { ...deps(), send: vi.fn(async () => { throw new Error('MailerSend rejected the message with status 401'); }) };
    const r = await requestSignIn(post('/admin/sign-in/request/', { email: OWNER }), d);
    expect(r.status).toBe(303);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(String(spy.mock.calls[0])).not.toMatch(/[0-9a-f]{64}/);
    spy.mockRestore();
  });
});

describe('confirmLink and submitSignInCode', () => {
  it('a link sets a host-only, HttpOnly, Secure, SameSite=Strict code-stage cookie; the right code activates it', async () => {
    const token = await linkToken();
    const c = await confirmLink(post('/admin/sign-in/link/confirm/', { token }), deps());
    expect(c.status).toBe(303);
    expect(c.headers.get('location')).toBe('/admin/sign-in/code/');
    const setCookie = c.headers.get('set-cookie')!;
    for (const part of ['__Host-sk_admin=', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict']) expect(setCookie).toContain(part);
    expect(setCookie).not.toContain('Domain');
    const session = cookieValue(c);
    expect(await getAdmin(db, session, env, NOW)).toBeNull();

    const code = totpAt(secret, Math.floor(NOW.getTime() / 30_000));
    const r = await submitSignInCode(post('/admin/sign-in/code/submit/', { csrf: csrfToken(session), code }, { ...ORIGIN, cookie: `__Host-sk_admin=${session}` }), deps());
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/admin/');
    expect(await getAdmin(db, session, env, NOW)).toEqual({ email: OWNER });
    expect(await auditCount('sign_in_code_ok')).toBe(1);
  });

  it('a used or junk link is sent back to sign in with no cookie', async () => {
    const token = await linkToken();
    await confirmLink(post('/admin/sign-in/link/confirm/', { token }), deps());
    const again = await confirmLink(post('/admin/sign-in/link/confirm/', { token }), deps());
    expect(again.headers.get('location')).toBe('/admin/sign-in/?expired=1');
    expect(again.headers.get('set-cookie')).toBeNull();
  });

  it('a code without the session CSRF token, or from a foreign origin, is refused', async () => {
    const token = await linkToken();
    const session = cookieValue(await confirmLink(post('/admin/sign-in/link/confirm/', { token }), deps()));
    const cookie = `__Host-sk_admin=${session}`;
    expect((await submitSignInCode(post('/admin/sign-in/code/submit/', { code: '123456' }, { ...ORIGIN, cookie }), deps())).status).toBe(403);
    expect((await submitSignInCode(post('/admin/sign-in/code/submit/', { csrf: csrfToken('other'), code: '123456' }, { ...ORIGIN, cookie }), deps())).status).toBe(403);
    expect((await submitSignInCode(post('/admin/sign-in/code/submit/', { csrf: csrfToken(session), code: '123456' }, { host: 'a', origin: 'https://b', cookie }), deps())).status).toBe(403);
  });

  it('rotating client addresses cannot add guesses: the challenge locks after five wrong codes from anywhere', async () => {
    const token = await linkToken();
    const session = cookieValue(await confirmLink(post('/admin/sign-in/link/confirm/', { token }), deps()));
    const statuses: (string | null)[] = [];
    for (let i = 0; i < 6; i++) {
      const headers = { ...ORIGIN, cookie: `__Host-sk_admin=${session}`, 'x-forwarded-for': `198.51.${i}.${i}` };
      const r = await submitSignInCode(post('/admin/sign-in/code/submit/', { csrf: csrfToken(session), code: '000000' }, headers), deps());
      statuses.push(r.headers.get('location'));
    }
    expect(statuses.slice(0, 4)).toEqual(Array(4).fill('/admin/sign-in/code/?error=1'));
    expect(statuses[4]).toBe('/admin/sign-in/?expired=1');
    const right = totpAt(secret, Math.floor(NOW.getTime() / 30_000) + 1);
    const after = await submitSignInCode(post('/admin/sign-in/code/submit/', { csrf: csrfToken(session), code: right }, { ...ORIGIN, cookie: `__Host-sk_admin=${session}` }), deps());
    expect(after.headers.get('location')).toBe('/admin/sign-in/?expired=1');
    expect(await getAdmin(db, session, env, NOW)).toBeNull();
  });

  it('a wrong code is audited and sent back to the code page; five end the session and clear the cookie', async () => {
    const token = await linkToken();
    const session = cookieValue(await confirmLink(post('/admin/sign-in/link/confirm/', { token }), deps()));
    const headers = { ...ORIGIN, cookie: `__Host-sk_admin=${session}` };
    let r: Response | undefined;
    for (let i = 0; i < 5; i++) r = await submitSignInCode(post('/admin/sign-in/code/submit/', { csrf: csrfToken(session), code: '000000' }, headers), deps());
    expect(r!.headers.get('location')).toBe('/admin/sign-in/?expired=1');
    expect(r!.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await auditCount('sign_in_code_bad')).toBeGreaterThanOrEqual(4);
    expect(await auditCount('sign_in_locked')).toBeGreaterThanOrEqual(1);
  });
});
