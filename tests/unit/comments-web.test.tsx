// @vitest-environment node
// Comments (plan 7A Task 2): the POST routes, the item-page section loader and markup, and the owner's switches.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { switchToProfile } from '@/lib/accounts/context';
import { createChildProfile } from '@/lib/accounts/children';
import { setTrust } from '@/lib/comments/trust';
import { postComment } from '@/lib/comments/repo';
import {
  deleteCommentRequest,
  editCommentRequest,
  loadCommentSection,
  postCommentRequest,
  relativeTime,
} from '@/lib/comments/web';
import { commentSwitches, trustByComment } from '@/lib/comments/admin';
import CommentSection from '@/components/comments/CommentSection';
import { runAction } from '@/lib/admin/actions';
import { formatDay } from '@/lib/public/dates';
import { handleAdminAction } from '@/lib/admin/act';
import { newTotpSecret, totpAt } from '@/lib/admin/totp';
import { sealSecret, TEST_SECRET_KEY } from '@/lib/admin/secret-box';
import { consumeLink, csrfToken, requestLink, submitCode } from '@/lib/admin/sessions';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const NOW = new Date('2026-11-05T12:00:00Z');
const ORIGIN = { host: 'sparkkindly.com', origin: 'https://sparkkindly.com' };
const OWNER = 'owner@example.test';
const env = { ADMIN_EMAILS: OWNER, ADMIN_SECRET_KEY: TEST_SECRET_KEY };
let n = 0;
let adminSession: string;

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
beforeEach(async () => {
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('COMMENTS_ENABLED', 'true');
  await db.query('DELETE FROM accounts');
  await db.query("DELETE FROM items WHERE created_by = 'test'");
  await db.query('UPDATE worlds SET comments_enabled = (slug <> $1)', ['kids']);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function item(world = 'play', audience = 'all'): Promise<{ id: string; path: string }> {
  const slug = `cw-${n++}`;
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     SELECT id, 'article', $2, 'T', 'S', '{}'::jsonb, $3, 'published', '2026-10-31T00:00:00Z', 'test', 'reflective', 'test'
     FROM worlds WHERE slug = $1 RETURNING id`,
    [world, slug, audience],
  );
  return { id: r.rows[0].id, path: `/${world}/${slug}/` };
}
async function person(dateOfBirth = '1990-05-05', parentEmail?: string) {
  const email = `cw${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth, parentEmail }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, T0))!, T0))!;
  return { id: r.accountId, email, session };
}
async function childOf(p: { id: string; session: string }) {
  const kid = await createChildProfile(db, p.id, { displayName: 'Kid', ageBand: '10-12', guardianConfirmed: 'on', pin: '4826' }, T0);
  if (kid.status !== 'created') throw new Error('profile failed');
  expect(await switchToProfile(db, p.session, kid.profileId, NOW)).toBe(true);
}
const req = (path: string, fields: Record<string, string>, session?: string, headers: Record<string, string> = ORIGIN) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
      ...(session ? { cookie: `__Host-sk_account=${session}` } : {}),
    },
    body: new URLSearchParams(fields).toString(),
  });
const deps = () => ({ db, now: NOW });
const first = { display_name: 'Sam', guidelines: 'on' };
const count = async () => (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM comments')).rows[0].n;
const level1 = (id: string) => db.transaction((tx) => setTrust(tx, id, { level: 1 }));
const html = async (token: string | undefined, itemId: string, code?: string) => {
  const data = await loadCommentSection(db, token, itemId, NOW);
  return data ? renderToStaticMarkup(<CommentSection data={data} code={code} />) : '';
};

describe('flags off', () => {
  it('every comment route is a 404 and the item page gets no section', async () => {
    for (const [a, c] of [['true', ''], ['', 'true']]) {
      vi.stubEnv('ACCOUNTS_ENABLED', a);
      vi.stubEnv('COMMENTS_ENABLED', c);
      const p = await person();
      const it1 = await item();
      for (const fn of [postCommentRequest, editCommentRequest, deleteCommentRequest]) {
        expect((await fn(req('/comments/x/', { item: it1.id, body: 'hi', ...first }, p.session), deps())).status).toBe(404);
      }
      expect(await loadCommentSection(db, p.session, it1.id, NOW)).toBeNull();
      expect(await loadCommentSection(db, undefined, it1.id, NOW)).toBeNull();
    }
    expect(await count()).toBe(0);
  });
});

describe('posting through the route', () => {
  it('refuses a foreign or missing Origin with 403', async () => {
    const p = await person();
    const it1 = await item();
    for (const headers of [{ host: 'sparkkindly.com', origin: 'https://evil.example' }, { host: 'sparkkindly.com' }] as Record<string, string>[]) {
      const r = await postCommentRequest(req('/comments/post/', { item: it1.id, body: 'hi', ...first }, p.session, headers), deps());
      expect(r.status).toBe(403);
    }
    expect(await count()).toBe(0);
  });

  it('sends an anonymous visitor to sign in; a child context gets 403; nothing is stored', async () => {
    const it1 = await item();
    const anon = await postCommentRequest(req('/comments/post/', { item: it1.id, body: 'hi', ...first }), deps());
    expect([anon.status, anon.headers.get('location')]).toEqual([303, '/account/sign-in/']);
    const p = await person();
    await childOf(p);
    expect((await postCommentRequest(req('/comments/post/', { item: it1.id, body: 'hi', ...first }, p.session), deps())).status).toBe(403);
    expect(await count()).toBe(0);
  });

  it('the author is always the session account, whatever ids the form carries; back to the item with an outcome code', async () => {
    const p = await person();
    const other = await person();
    const it1 = await item();
    const fields = { item: it1.id, body: 'hello there', account: other.id, account_id: other.id, ...first };
    const r = await postCommentRequest(req('/comments/post/', fields, p.session), deps());
    expect([r.status, r.headers.get('location')]).toEqual([303, `${it1.path}?c=held#result`]);
    const rows = (await db.query<{ account_id: string }>('SELECT account_id FROM comments')).rows;
    expect(rows).toEqual([{ account_id: p.id }]);
  });

  it('an unknown or forged item goes home with no row', async () => {
    const p = await person();
    for (const id of ['nope', '00000000-0000-0000-0000-000000000001']) {
      const r = await postCommentRequest(req('/comments/post/', { item: id, body: 'hi', ...first }, p.session), deps());
      expect(r.headers.get('location')).toBe('/?c=no_item#result');
    }
    expect(await count()).toBe(0);
  });

  it('edit and delete act only on the session account’s own comments', async () => {
    const a = await person();
    const b = await person();
    await level1(a.id);
    const it1 = await item();
    const posted = await postComment(db, { account: { id: a.id } as never, profile: null, audiences: [] }, { itemId: it1.id, body: 'mine', displayName: 'Ann', guidelines: 'on' }, NOW);
    if (posted.status === 'refused') throw new Error('refused');
    const edit = (s: string, body: string) => editCommentRequest(req('/comments/edit/', { item: it1.id, comment: posted.id, body }, s), deps());
    expect((await edit(b.session, 'hijack')).headers.get('location')).toBe(`${it1.path}?c=not_found#result`);
    expect((await edit(a.session, 'mine, better')).headers.get('location')).toBe(`${it1.path}?c=saved#result`);
    const del = (s: string) => deleteCommentRequest(req('/comments/delete/', { item: it1.id, comment: posted.id }, s), deps());
    expect((await del(b.session)).headers.get('location')).toBe(`${it1.path}?c=gone#result`);
    expect((await db.query('SELECT body FROM comments')).rows[0].body).toBe('mine, better');
    expect((await del(a.session)).headers.get('location')).toBe(`${it1.path}?c=deleted#result`);
    await childOf(a);
    expect((await edit(a.session, 'child')).status).toBe(403);
    expect((await del(a.session)).status).toBe(403);
  });
});

describe('the item-page section', () => {
  async function thread() {
    const a = await person();
    const b = await person();
    await level1(a.id);
    const it1 = await item();
    const ctx = (id: string) => ({ account: { id } as never, profile: null, audiences: [] });
    await postComment(db, ctx(a.id), { itemId: it1.id, body: 'Read more at www.example.org', displayName: 'Ann', guidelines: 'on' }, NOW);
    await postComment(db, ctx(b.id), { itemId: it1.id, body: 'Waiting words', displayName: 'Bea', guidelines: 'on' }, NOW);
    return { a, b, it1 };
  }

  it('anonymous visitors read published comments only, with no form', async () => {
    const { it1 } = await thread();
    const out = await html(undefined, it1.id);
    expect(out).toContain('id="comments"');
    expect(out).toContain('Read more at www.example.org');
    expect(out).not.toContain('Waiting words');
    expect(out).not.toContain('<textarea');
    expect(out).toMatch(/href="\/account\/sign-in\/?"/);
  });

  it('a link in a level-1 comment is plain text, never an anchor', async () => {
    const { it1 } = await thread();
    const out = await html(undefined, it1.id);
    expect(out).not.toMatch(/<a[^>]*example\.org/);
    expect(out).toMatch(/<time dateTime="2026-11-05T12:00:00.000Z">just now<\/time>/i);
  });

  it('the author sees their held comment marked as waiting for review; others do not', async () => {
    const { a, b, it1 } = await thread();
    const mine = await html(b.session, it1.id);
    expect(mine).toContain('Waiting words');
    expect(mine).toContain('Waiting for review');
    expect(mine).not.toContain('Display name');
    const theirs = await html(a.session, it1.id);
    expect(theirs).not.toContain('Waiting words');
    expect(theirs).toContain('<textarea');
  });

  it('a first-time commenter is asked for a display name and the guidelines tick', async () => {
    const p = await person();
    const it1 = await item();
    const out = await html(p.session, it1.id);
    expect(out).toContain('Display name');
    expect(out).toContain('I have read the');
    expect(out).toMatch(/href="\/community\/guidelines\/?"/);
  });

  it('a child context gets no section at all; a 13-15 account reads but gets no form', async () => {
    const { it1 } = await thread();
    const parent = await person();
    await childOf(parent);
    expect(await loadCommentSection(db, parent.session, it1.id, NOW)).toBeNull();
    const teen = await person('2012-01-01', `p${n++}@example.test`);
    await db.query("UPDATE accounts SET consent_state = 'confirmed' WHERE id = $1", [teen.id]);
    const out = await html(teen.session, it1.id);
    expect(out).toContain('Read more at www.example.org');
    expect(out).not.toContain('<textarea');
  });

  it('no section on Kids items or when switched off', async () => {
    for (const k of [await item('kids', 'kids'), await item('play', 'kids')]) {
      expect(await loadCommentSection(db, undefined, k.id, NOW)).toBeNull();
    }
    const it1 = await item();
    await db.query('UPDATE items SET comments_enabled = false WHERE id = $1', [it1.id]);
    expect(await loadCommentSection(db, undefined, it1.id, NOW)).toBeNull();
  });

  it('shows the outcome of the last post from a fixed list (unknown codes show nothing)', async () => {
    const it1 = await item();
    expect(await html(undefined, it1.id, 'held')).toContain('waiting for review');
    expect(await html(undefined, it1.id, '<script>')).not.toContain('script');
  });

  it('relative times', () => {
    const m = 60_000;
    expect(relativeTime(NOW, NOW)).toBe('just now');
    expect(relativeTime(new Date(NOW.getTime() - 5 * m), NOW)).toBe('5 minutes ago');
    expect(relativeTime(new Date(NOW.getTime() - 60 * m), NOW)).toBe('1 hour ago');
    expect(relativeTime(new Date(NOW.getTime() - 3 * 24 * 60 * m), NOW)).toBe('3 days ago');
    expect(relativeTime(new Date('2026-09-01T00:00:00Z'), NOW)).toBe(formatDay(new Date('2026-09-01T00:00:00Z')));
  });
});

describe('owner switches and trust', () => {
  const act = (name: string, fields: Record<string, string>) => runAction(db, { email: OWNER }, name, new URLSearchParams(fields), NOW);
  const audits = async (action: string) =>
    (await db.query<{ target: string }>('SELECT target FROM audit_log WHERE action = $1', [action])).rows.map((r) => r.target);

  it('world switch, audited; never offered or accepted for Kids', async () => {
    expect(await act('comments.world_toggle', { slug: 'play', enabled: 'false' })).toMatchObject({ ok: true });
    expect((await db.query("SELECT comments_enabled FROM worlds WHERE slug = 'play'")).rows[0].comments_enabled).toBe(false);
    expect(await audits('comments.world_toggle')).toContain('world:play');
    expect(await act('comments.world_toggle', { slug: 'kids', enabled: 'true' })).toMatchObject({ ok: false, code: 'kids_comments' });
    expect((await commentSwitches(db)).worlds.map((w) => w.slug)).not.toContain('kids');
  });

  it('item switch by its path: on, off or inherit; Kids items refused', async () => {
    const it1 = await item();
    for (const [value, stored] of [['off', false], ['on', true], ['inherit', null]] as const) {
      expect(await act('comments.item_toggle', { item: it1.path, value })).toMatchObject({ ok: true });
      expect((await db.query('SELECT comments_enabled FROM items WHERE id = $1', [it1.id])).rows[0].comments_enabled).toBe(stored);
    }
    expect(await act('comments.item_toggle', { item: (await item('kids', 'kids')).path, value: 'on' })).toMatchObject({ ok: false, code: 'kids_comments' });
    expect(await act('comments.item_toggle', { item: (await item('play', 'kids')).path, value: 'on' })).toMatchObject({ ok: false, code: 'kids_comments' });
    expect(await act('comments.item_toggle', { item: '/play/missing/', value: 'on' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await act('comments.item_toggle', { item: it1.path, value: 'maybe' })).toMatchObject({ ok: false, code: 'bad_input' });
  });

  it('trust set and ban by comment id or link; the lookup shows no email or account id; audited by comment', async () => {
    const p = await person();
    const it1 = await item();
    const r = await postComment(db, { account: { id: p.id } as never, profile: null, audiences: [] }, { itemId: it1.id, body: 'hello', displayName: 'Sam', guidelines: 'on' }, NOW);
    if (r.status === 'refused') throw new Error('refused');
    expect(await act('comments.trust_set', { comment: r.id, level: '1' })).toMatchObject({ ok: true });
    expect(await act('comments.ban', { comment: `https://sparkkindly.com${it1.path}#comment-${r.id}`, banned: 'true' })).toMatchObject({ ok: true });
    const t = await trustByComment(db, r.id);
    expect(t).toEqual({ comment: r.id, displayName: 'Sam', level: 1, approved: 0, rejected: 0, banned: true });
    expect(JSON.stringify(t)).not.toContain(p.email);
    expect(JSON.stringify(t)).not.toContain(p.id);
    expect(await audits('comments.ban')).toEqual([`comment:${r.id}`]);
    expect(await act('comments.trust_set', { comment: r.id, level: '2' })).toMatchObject({ ok: false, code: 'bad_input' });
    expect(await act('comments.trust_set', { comment: '00000000-0000-0000-0000-000000000001', level: '1' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await trustByComment(db, 'nope')).toBeNull();
  });

  it('the actions need an admin session and the CSRF token', async () => {
    const p = await person();
    const post = (cookie: string, csrf: string) =>
      handleAdminAction(
        new Request('http://localhost/admin/act/', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', ...ORIGIN, cookie },
          body: new URLSearchParams({ action: 'comments.world_toggle', slug: 'grow', enabled: 'false', csrf, return: '/admin/comments/' }).toString(),
        }),
        { db, env, now: NOW },
      );
    expect((await post(`__Host-sk_account=${p.session}`, 'x')).headers.get('location')).toBe('/admin/sign-in/');
    expect((await post(`__Host-sk_admin=${adminSession}`, 'wrong')).status).toBe(403);
    expect((await db.query("SELECT comments_enabled FROM worlds WHERE slug = 'grow'")).rows[0].comments_enabled).toBe(true);
    const ok = await post(`__Host-sk_admin=${adminSession}`, csrfToken(adminSession));
    expect(ok.headers.get('location')).toBe('/admin/comments/?done=comments_world_off');
  });
});
