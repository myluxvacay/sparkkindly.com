// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { newTotpSecret, totpAt } from '@/lib/admin/totp';
import { sealSecret, TEST_SECRET_KEY } from '@/lib/admin/secret-box';
import { consumeLink, csrfToken, getAdmin, requestLink, submitCode } from '@/lib/admin/sessions';
import { handleAdminAction, showAgentKey } from '@/lib/admin/act';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let secret: string;
let session: string;
let pending: string;
const OWNER = 'owner@example.test';
const env = { ADMIN_EMAILS: OWNER, ADMIN_SECRET_KEY: TEST_SECRET_KEY };
const NOW = new Date('2026-11-01T10:00:00Z');
const ORIGIN = { host: 'sparkkindly.com', origin: 'https://sparkkindly.com' };

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  secret = newTotpSecret();
  await db.query('INSERT INTO admin_users (email, totp_secret) VALUES ($1, $2)', [OWNER, sealSecret(secret, OWNER, env)]);
  const first = (await consumeLink(db, (await requestLink(db, OWNER, env, NOW))!, env, NOW))!;
  session = (await submitCode(db, first, totpAt(secret, Math.floor(NOW.getTime() / 30_000)), env, NOW)).session!;
  pending = (await consumeLink(db, (await requestLink(db, OWNER, env, NOW))!, env, NOW))!;
});
afterAll(async () => {
  await db.close();
});

function post(fields: Record<string, string>, opts: { cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', ...ORIGIN, ...opts.headers };
  if (opts.cookie !== undefined) headers.cookie = `__Host-sk_admin=${opts.cookie}`;
  return new Request('http://localhost/admin/act/', { method: 'POST', headers, body: new URLSearchParams(fields).toString() });
}
const run = (r: Request, e: Record<string, string> = env) => handleAdminAction(r, { db, env: e, now: NOW });
const topic = (slug: string) => ({ action: 'topic.create', slug, name: 'A topic', return: '/admin/topics/' });
const topicExists = async (slug: string) => (await db.query('SELECT 1 FROM topics WHERE slug = $1', [slug])).rows.length === 1;

describe('handleAdminAction', () => {
  it('runs an action for a signed-in admin with the right CSRF token and returns to the page', async () => {
    const r = await run(post({ ...topic('act-ok'), csrf: csrfToken(session) }, { cookie: session }));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/admin/topics/?done=topic_added');
    expect(await topicExists('act-ok')).toBe(true);
  });

  it('refuses no Origin and a foreign Origin with 403 and changes nothing', async () => {
    const noOrigin = post({ ...topic('act-a'), csrf: csrfToken(session) }, { cookie: session, headers: { origin: '' } });
    expect((await run(noOrigin)).status).toBe(403);
    const foreign = post({ ...topic('act-b'), csrf: csrfToken(session) }, { cookie: session, headers: { origin: 'https://evil.example' } });
    expect((await run(foreign)).status).toBe(403);
    expect(await topicExists('act-a')).toBe(false);
    expect(await topicExists('act-b')).toBe(false);
  });

  it("refuses a missing CSRF token and another session's token", async () => {
    expect((await run(post(topic('act-c'), { cookie: session }))).status).toBe(403);
    expect((await run(post({ ...topic('act-d'), csrf: csrfToken(pending) }, { cookie: session }))).status).toBe(403);
    expect(await topicExists('act-c')).toBe(false);
    expect(await topicExists('act-d')).toBe(false);
  });

  it('sends anyone without an admin session to sign in: no cookie, a code-stage session, a forged token', async () => {
    for (const cookie of [undefined, pending, 'f'.repeat(64)]) {
      const r = await run(post({ ...topic('act-e'), csrf: csrfToken(cookie ?? '') }, { cookie }));
      expect(r.status).toBe(303);
      expect(r.headers.get('location')).toBe('/admin/sign-in/');
    }
    expect(await topicExists('act-e')).toBe(false);
  });

  it('refuses an address that has left the allow-list', async () => {
    const r = await run(post({ ...topic('act-f'), csrf: csrfToken(session) }, { cookie: session }), { ADMIN_EMAILS: 'other@example.test' });
    expect(r.headers.get('location')).toBe('/admin/sign-in/');
    expect(await topicExists('act-f')).toBe(false);
  });

  it('never redirects off /admin/, and reports failures on the page', async () => {
    const r = await run(post({ ...topic('Bad Slug'), csrf: csrfToken(session), return: '//evil.example/' }, { cookie: session }));
    expect(r.headers.get('location')).toBe('/admin/?error=bad_input');
  });

  it('refuses an oversized body', async () => {
    const r = await run(post({ ...topic('act-g'), csrf: csrfToken(session), pad: 'x'.repeat(9000) }, { cookie: session }));
    expect(r.status).toBe(413);
  });

  it('hands a new agent key over once: the POST redirects, the key page shows it once, and a reload shows it no more', async () => {
    const r = await run(post({ action: 'agent.create', name: 'act-agent', world: 'play', csrf: csrfToken(session), return: '/admin/agents/' }, { cookie: session }));
    expect(r.status).toBe(303);
    const location = r.headers.get('location')!;
    expect(location).toMatch(/^\/admin\/act\/key\/\?ref=[0-9a-f]{32}$/);
    expect(location).not.toMatch(/skagt_/);
    const get = (cookie: string) =>
      new Request(`http://localhost${location}`, { headers: { cookie: `__Host-sk_admin=${cookie}` } });
    // Another admin session cannot collect it.
    const otherLink = (await requestLink(db, OWNER, env, NOW))!;
    const otherPending = (await consumeLink(db, otherLink, env, NOW))!;
    await db.query('UPDATE admin_users SET totp_last_step = 0'); // a second sign-in in the same 30 s window
    const other = (await submitCode(db, otherPending, totpAt(secret, Math.floor(NOW.getTime() / 30_000) - 1), env, NOW)).session!;
    const stolen = await showAgentKey(get(other), { db, env, now: NOW });
    expect(await stolen.text()).not.toMatch(/skagt_/);
    const first = await showAgentKey(get(session), { db, env, now: NOW });
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const key = /skagt_[0-9a-f]{8}_[0-9a-f]{48}/.exec(await first.text())?.[0];
    expect(key).toBeTruthy();
    const reload = await showAgentKey(get(session), { db, env, now: NOW });
    expect(reload.status).toBe(410);
    expect(await reload.text()).not.toMatch(/skagt_/);
    // The reload did not rotate anything: the one agent still has the key that was shown.
    const agents = await db.query("SELECT count(*)::int AS n FROM agents WHERE name = 'act-agent'");
    expect(agents.rows[0]).toEqual({ n: 1 });
  });

  it('a handed-over key expires after five minutes', async () => {
    const r = await run(post({ action: 'agent.create', name: 'act-agent-2', world: 'play', csrf: csrfToken(session), return: '/admin/agents/' }, { cookie: session }));
    const location = r.headers.get('location')!;
    const late = new Date(NOW.getTime() + 5 * 60_000 + 1000);
    const page = await showAgentKey(new Request(`http://localhost${location}`, { headers: { cookie: `__Host-sk_admin=${session}` } }), { db, env, now: late });
    expect(await page.text()).not.toMatch(/skagt_/);
  });

  it('signs out: the session ends and the cookie is cleared', async () => {
    const link = (await requestLink(db, OWNER, env, NOW))!;
    const pendingS = (await consumeLink(db, link, env, NOW))!;
    await db.query('UPDATE admin_users SET totp_last_step = 0');
    const s = (await submitCode(db, pendingS, totpAt(secret, Math.floor(NOW.getTime() / 30_000) + 1), env, NOW)).session!;
    const r = await run(post({ action: 'session.end', csrf: csrfToken(s), return: '/admin/sign-in/' }, { cookie: s }));
    expect(r.headers.get('location')).toBe('/admin/sign-in/');
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await getAdmin(db, s, env, NOW)).toBeNull();
    const audits = await db.query("SELECT actor FROM audit_log WHERE action = 'session.end'");
    expect(audits.rows).toEqual([{ actor: OWNER }]);
  });
});

describe('status messages', () => {
  it('map only known codes to server-side text', async () => {
    const { doneText, errorText } = await import('@/lib/admin/messages');
    expect(doneText('topic_added')).toBe('Topic added.');
    expect(errorText('reserved_slug')).toMatch(/page name on the site/);
    expect(doneText('Your account is compromised, call 555')).toBeNull();
    expect(errorText('constructor')).toBeNull();
    expect(doneText(undefined)).toBeNull();
  });
});
