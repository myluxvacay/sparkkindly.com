// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { newTotpSecret, totpAt } from '@/lib/admin/totp';
import { consumeLink, csrfToken, getAdmin, requestLink, submitCode } from '@/lib/admin/sessions';
import { handleAdminAction } from '@/lib/admin/act';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let secret: string;
let session: string;
let pending: string;
const OWNER = 'owner@example.test';
const env = { ADMIN_EMAILS: OWNER };
const NOW = new Date('2026-11-01T10:00:00Z');
const ORIGIN = { host: 'sparkkindly.com', origin: 'https://sparkkindly.com' };

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  secret = newTotpSecret();
  await db.query('INSERT INTO admin_users (email, totp_secret) VALUES ($1, $2)', [OWNER, secret]);
  session = (await consumeLink(db, (await requestLink(db, OWNER, env, NOW))!, env, NOW))!;
  expect(await submitCode(db, session, totpAt(secret, Math.floor(NOW.getTime() / 30_000)), env, NOW)).toBe('ok');
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
    expect(r.headers.get('location')).toBe('/admin/topics/?done=Topic%20added.');
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
    expect(r.headers.get('location')).toMatch(/^\/admin\/\?error=/);
  });

  it('refuses an oversized body', async () => {
    const r = await run(post({ ...topic('act-g'), csrf: csrfToken(session), pad: 'x'.repeat(9000) }, { cookie: session }));
    expect(r.status).toBe(413);
  });

  it('shows a new agent key once on a no-store page and never in the Location header', async () => {
    const r = await run(post({ action: 'agent.create', name: 'act-agent', world: 'play', csrf: csrfToken(session), return: '/admin/agents/' }, { cookie: session }));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('location')).toBeNull();
    expect(await r.text()).toMatch(/skagt_[0-9a-f]{8}_[0-9a-f]{48}/);
  });

  it('signs out: the session ends and the cookie is cleared', async () => {
    const link = (await requestLink(db, OWNER, env, NOW))!;
    const s = (await consumeLink(db, link, env, NOW))!;
    expect(await submitCode(db, s, totpAt(secret, Math.floor(NOW.getTime() / 30_000) + 1), env, NOW)).toBe('ok');
    const r = await run(post({ action: 'session.end', csrf: csrfToken(s), return: '/admin/sign-in/' }, { cookie: s }));
    expect(r.headers.get('location')).toBe('/admin/sign-in/');
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await getAdmin(db, s, env, NOW)).toBeNull();
    const audits = await db.query("SELECT actor FROM audit_log WHERE action = 'session.end'");
    expect(audits.rows).toEqual([{ actor: OWNER }]);
  });
});
