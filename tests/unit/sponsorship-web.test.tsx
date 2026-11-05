// @vitest-environment node
// Sponsorship on the web (plan 6 Task 2): the item-page loader, the SponsorLine markup, the /go/<id>/ click route and
// the audited admin actions. With SPONSORSHIP_ENABLED off nothing is read and every route is a 404.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { newTestDb } from '../helpers/test-db';
import { person } from '../helpers/comments';
import { seedReference } from '@/db/seed';
import { createChildProfile } from '@/lib/accounts/children';
import { switchToProfile } from '@/lib/accounts/context';
import { runAction } from '@/lib/admin/actions';
import { handleAdminAction } from '@/lib/admin/act';
import { newTotpSecret, totpAt } from '@/lib/admin/totp';
import { sealSecret, TEST_SECRET_KEY } from '@/lib/admin/secret-box';
import { consumeLink, csrfToken, requestLink, submitCode } from '@/lib/admin/sessions';
import { clickHead, clickRequest, loadSponsorLine } from '@/lib/sponsorship/web';
import { listSponsorsAdmin } from '@/lib/sponsorship/admin';
import SponsorLine from '@/components/sponsorship/SponsorLine';
import type { Db } from '@/lib/db';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-05T12:00:00Z');
const OWNER = 'owner@example.test';
const ADMIN = { email: OWNER };
const env = { ADMIN_EMAILS: OWNER, ADMIN_SECRET_KEY: TEST_SECRET_KEY };
const ORIGIN = { host: 'sparkkindly.com', origin: 'https://sparkkindly.com' };
const LINK = 'https://acme.example/budget';
let adminSession: string;
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const secret = newTotpSecret();
  await db.query('INSERT INTO admin_users (email, totp_secret) VALUES ($1, $2)', [OWNER, sealSecret(secret, OWNER, env)]);
  const first = (await consumeLink(db, (await requestLink(db, OWNER, env, NOW))!, env, NOW))!;
  adminSession = (await submitCode(db, first, totpAt(secret, Math.floor(NOW.getTime() / 30_000)), env, NOW)).session!;
});
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  vi.stubEnv('SPONSORSHIP_ENABLED', 'true');
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
});

const act = (name: string, fields: Record<string, string>) => runAction(db, ADMIN, name, new URLSearchParams(fields), NOW);

async function item(audience = 'adults', world = 'grow', topic?: string): Promise<{ id: string; path: string }> {
  const slug = `sw-item-${n++}`;
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     SELECT id, 'article', $2, 'T', 'S', '{}'::jsonb, $3, 'published', '2026-11-01T00:00:00Z', 'test', $4, 'owner'
     FROM worlds WHERE slug = $1 RETURNING id`,
    [world, slug, audience, world === 'kids' ? 'kids' : 'reflective'],
  );
  const id = r.rows[0].id;
  if (topic) await db.query('INSERT INTO item_topics (item_id, topic_id) SELECT $1, id FROM topics WHERE slug = $2', [id, topic]);
  return { id, path: `${world}/${slug}` };
}

async function sponsorId(name = 'Acme Money'): Promise<string> {
  const r = await act('sponsor.create', { name, link: LINK, category: 'finance-education', confirmed: 'on' });
  expect(r).toMatchObject({ ok: true, code: 'sponsor_created' });
  return String((await db.query<{ id: number }>('SELECT max(id) AS id FROM sponsors')).rows[0].id);
}

async function topicSponsorship(): Promise<{ topic: string; id: number }> {
  const topic = `sw-topic-${n++}`;
  await db.query("INSERT INTO topics (slug, name) VALUES ($1, 'Money')", [topic]);
  const r = await act('sponsorship.attach', { sponsor: await sponsorId(), target: 'topic', ref: topic, label: 'Budget with Acme', kind: 'supported' });
  expect(r).toMatchObject({ ok: true, code: 'sponsorship_attached' });
  return { topic, id: (await db.query<{ id: number }>('SELECT max(id) AS id FROM sponsorships')).rows[0].id };
}

const clicks = async (id: number) =>
  (await db.query<{ c: number }>('SELECT click_count AS c FROM sponsorships WHERE id = $1', [id])).rows[0].c;
const go = (id: number | string, cookie?: string, ip = '203.0.113.9') =>
  new Request(`http://localhost/go/${id}/`, {
    headers: { 'x-forwarded-for': ip, ...(cookie ? { cookie: `__Host-sk_account=${cookie}` } : {}) },
  });

async function childSession(): Promise<string> {
  const p = await person(db, NOW);
  const kid = await createChildProfile(db, p.id, { displayName: 'Kid', ageBand: '10-12', guardianConfirmed: 'on', pin: '4826' }, NOW);
  if (kid.status !== 'created') throw new Error('profile failed');
  expect(await switchToProfile(db, p.session, kid.profileId, NOW)).toBe(true);
  return p.session;
}

describe('loadSponsorLine', () => {
  it('with the flag off reads nothing and returns null', async () => {
    vi.stubEnv('SPONSORSHIP_ENABLED', '');
    const query = vi.fn(() => Promise.reject(new Error('must not query')));
    expect(await loadSponsorLine({ query } as unknown as Db, 'a'.repeat(64), '00000000-0000-0000-0000-000000000000', NOW)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('gives an anonymous visitor and a signed-in adult the line on an adults item', async () => {
    const { topic, id } = await topicSponsorship();
    const i = await item('adults', 'grow', topic);
    const line = await loadSponsorLine(db, undefined, i.id, NOW);
    expect(line).toMatchObject({ id, label: 'Budget with Acme', disclosure: 'This topic is supported by Acme Money. Acme Money had no say in what we publish.' });
    expect(await loadSponsorLine(db, (await person(db, NOW)).session, i.id, NOW)).toMatchObject({ id });
  });

  it('gives a child profile, a 16-17 or 13-15 account, a failed lookup, an all item and a Kids item nothing', async () => {
    const { topic } = await topicSponsorship();
    const i = await item('adults', 'grow', topic);
    expect(await loadSponsorLine(db, await childSession(), i.id, NOW)).toBeNull();
    expect(await loadSponsorLine(db, (await person(db, NOW, '2010-01-01')).session, i.id, NOW)).toBeNull();
    expect(await loadSponsorLine(db, (await person(db, NOW, '2012-01-01', 'parent@example.test')).session, i.id, NOW)).toBeNull();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { query: () => Promise.reject(new Error('down')) } as unknown as Db;
    expect(await loadSponsorLine(broken, 'a'.repeat(64), i.id, NOW)).toBeNull();
    spy.mockRestore();
    expect(await loadSponsorLine(db, undefined, (await item('all', 'grow', topic)).id, NOW)).toBeNull();
    expect(await loadSponsorLine(db, undefined, (await item('all', 'kids', topic)).id, NOW)).toBeNull();
  });
});

describe('SponsorLine', () => {
  it('is one text line: the label linking to /go/<id>/ with rel sponsored, the fixed disclosure and the explanation link', () => {
    const html = renderToStaticMarkup(
      <SponsorLine line={{ id: 7, label: 'Budget with Acme', kind: 'supported', sponsorName: 'Acme', disclosure: 'This topic is supported by Acme. Acme had no say in what we publish.' }} />,
    );
    expect(html).toContain('href="/go/7/"');
    expect(html).toContain('rel="sponsored noopener noreferrer"');
    expect(html).toContain('This topic is supported by Acme. Acme had no say in what we publish.');
    // next/link drops the trailing slash outside the app (trailingSlash comes from next.config); the e2e checks the real page.
    expect(html).toMatch(/href="\/sponsorship\/?"/);
    expect(html).not.toContain('acme.example');
    expect(html).not.toMatch(/<script|<img|<iframe/);
    expect(html.match(/rel="sponsored/g)).toHaveLength(1);
  });
});

describe('clickRequest', () => {
  it('with the flag off is a 404', async () => {
    vi.stubEnv('SPONSORSHIP_ENABLED', '');
    expect((await clickRequest(go(1), { db, now: NOW }, '1')).status).toBe(404);
  });

  it('redirects an eligible visitor to the stored link, counts once, sends no referrer, no cache and no cookie', async () => {
    const { id } = await topicSponsorship();
    const r = await clickRequest(go(id), { db, now: NOW }, String(id));
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(LINK);
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(await clicks(id)).toBe(1);
  });

  it('sends a child profile, a teen and a bad or unknown id home without counting', async () => {
    const { id } = await topicSponsorship();
    for (const cookie of [await childSession(), (await person(db, NOW, '2010-01-01')).session]) {
      const r = await clickRequest(go(id, cookie), { db, now: NOW }, String(id));
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe('/');
    }
    for (const raw of ['abc', '0', '99999999', 'https:%2F%2Fevil.example']) {
      expect((await clickRequest(go(raw), { db, now: NOW }, raw)).headers.get('location')).toBe('/');
    }
    expect(await clicks(id)).toBe(0);
  });

  it('a stored non-ASCII link becomes an ASCII Location header (never a thrown header error)', async () => {
    const { id } = await topicSponsorship();
    await db.query("UPDATE sponsors SET link = 'https://bücher.example/ä' WHERE id = (SELECT sponsor_id FROM sponsorships WHERE id = $1)", [id]);
    const r = await clickRequest(go(id, undefined, '203.0.113.77'), { db, now: NOW }, String(id));
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://xn--bcher-kva.example/%C3%A4');
  });

  it('HEAD sends everyone home and counts nothing; 404 with the flag off', async () => {
    const { id } = await topicSponsorship();
    const r = clickHead();
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/');
    expect(await clicks(id)).toBe(0);
    vi.stubEnv('SPONSORSHIP_ENABLED', '');
    expect(clickHead().status).toBe(404);
  });

  it('is rate limited per network', async () => {
    const { id } = await topicSponsorship();
    const limit = vi.fn(() => false);
    const r = await clickRequest(go(id), { db, now: NOW, limit }, String(id));
    expect(r.status).toBe(429);
    expect(limit).toHaveBeenCalledWith('203.0.113.9');
    expect(await clicks(id)).toBe(0);
  });
});

describe('admin actions', () => {
  it('sponsor.create records the confirmation in the audit row', async () => {
    await sponsorId('Audited Books');
    const a = (await db.query<{ action: string; detail: Record<string, unknown> }>('SELECT action, detail FROM audit_log ORDER BY id DESC LIMIT 1')).rows[0];
    expect(a.action).toBe('sponsor.create');
    expect(a.detail).toMatchObject({ name: 'Audited Books', category: 'finance-education', confirmed: true });
    const row = (await db.query<{ confirmed_at: Date }>('SELECT confirmed_at FROM sponsors WHERE name = $1', ['Audited Books'])).rows[0];
    expect(row.confirmed_at).toEqual(NOW);
  });

  it('refuses an excluded or unknown category, a missing confirmation and an unsafe link', async () => {
    const base = { name: 'Bad', link: LINK, category: 'books', confirmed: 'on' };
    for (const change of [{ category: 'gambling' }, { category: 'alcohol' }, { category: 'cars' }, { confirmed: '' }, { link: 'http://acme.example/' }]) {
      expect(await act('sponsor.create', { ...base, ...change })).toMatchObject({ ok: false, status: 400, code: 'sponsor_rules' });
    }
    expect((await db.query("SELECT 1 FROM sponsors WHERE name = 'Bad'")).rows).toHaveLength(0);
  });

  it('sponsorship.attach refuses the Kids world, an all or Kids item, an unknown target and an unknown sponsor', async () => {
    const s = await sponsorId();
    const fields = { sponsor: s, label: 'L', kind: 'supported' };
    expect(await act('sponsorship.attach', { ...fields, target: 'world', ref: 'kids' })).toMatchObject({ ok: false, code: 'sponsor_target' });
    expect(await act('sponsorship.attach', { ...fields, target: 'item', ref: (await item('all')).path })).toMatchObject({ ok: false, code: 'sponsor_target' });
    expect(await act('sponsorship.attach', { ...fields, target: 'item', ref: (await item('all', 'kids')).path })).toMatchObject({ ok: false, code: 'sponsor_target' });
    expect(await act('sponsorship.attach', { ...fields, target: 'topic', ref: 'no-such-topic' })).toMatchObject({ ok: false, code: 'sponsor_target' });
    expect(await act('sponsorship.attach', { ...fields, sponsor: '999999', target: 'world', ref: 'grow' })).toMatchObject({ ok: false, status: 404 });
    expect(await act('sponsorship.attach', { ...fields, target: 'item', ref: (await item()).path })).toMatchObject({ ok: true });
    expect(await act('sponsorship.attach', { ...fields, target: 'world', ref: 'grow', label: 'x'.repeat(61) })).toMatchObject({ ok: false, status: 400 });
  });

  it('sponsorship.end stops the line at once; ending twice is refused', async () => {
    const { topic, id } = await topicSponsorship();
    const i = await item('adults', 'grow', topic);
    expect(await act('sponsorship.end', { id: String(id) })).toMatchObject({ ok: true, code: 'sponsorship_ended' });
    expect(await loadSponsorLine(db, undefined, i.id, NOW)).toBeNull();
    expect(await act('sponsorship.end', { id: String(id) })).toMatchObject({ ok: false, status: 404 });
  });

  it('are unknown with the flag off', async () => {
    vi.stubEnv('SPONSORSHIP_ENABLED', '');
    expect(await act('sponsor.create', { name: 'Off', link: LINK, category: 'books', confirmed: 'on' })).toMatchObject({ ok: false, code: 'unknown_action' });
  });

  it('go through /admin/act/ only with an admin session and its CSRF token', async () => {
    const post = (fields: Record<string, string>, cookie?: string) =>
      handleAdminAction(
        new Request('http://localhost/admin/act/', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', ...ORIGIN, ...(cookie ? { cookie: `__Host-sk_admin=${cookie}` } : {}) },
          body: new URLSearchParams({ action: 'sponsor.create', name: 'Via route', link: LINK, category: 'books', confirmed: 'on', return: '/admin/sponsors/', ...fields }).toString(),
        }),
        { db, env, now: NOW },
      );
    expect((await post({})).headers.get('location')).toBe('/admin/sign-in/');
    expect((await post({ csrf: 'wrong' }, adminSession)).status).toBe(403);
    expect((await db.query("SELECT 1 FROM sponsors WHERE name = 'Via route'")).rows).toHaveLength(0);
    expect((await post({ csrf: csrfToken(adminSession) }, adminSession)).headers.get('location')).toBe('/admin/sponsors/?done=sponsor_created');
  });

  it('the admin list shows each sponsorship with its click count; clicks cannot be edited by any action', async () => {
    const { id } = await topicSponsorship();
    await clickRequest(go(id, undefined, '203.0.113.50'), { db, now: NOW }, String(id));
    const list = await listSponsorsAdmin(db);
    expect(list.sponsorships.find((s) => s.id === id)).toMatchObject({ clicks: 1, label: 'Budget with Acme', target: expect.stringContaining('topic') });
    expect(list.sponsors.length).toBeGreaterThan(0);
    expect(await act('sponsorship.attach', { sponsor: '1', target: 'world', ref: 'grow', label: 'L', kind: 'supported', click_count: '999' })).toMatchObject({ ok: true });
    const latest = (await db.query<{ c: number }>('SELECT click_count AS c FROM sponsorships ORDER BY id DESC LIMIT 1')).rows[0].c;
    expect(latest).toBe(0);
  });
});
