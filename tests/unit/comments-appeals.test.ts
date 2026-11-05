// @vitest-environment node
// Appeals (plan 7B Task 2): a signed token bound to the comment and its author (30 days), one appeal per comment, a GET
// page that changes nothing and a POST behind it; the owner overturns (publishes, reverses the rejection in the counts,
// emails the author) or upholds (emails the author).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { comment, item, person, setLevel, statusOf, trustRow } from '../helpers/comments';
import { seedReference } from '@/db/seed';
import { appealState, appealToken, decideAppeal, fileAppeal, fileAppealRequest, verifyAppealToken } from '@/lib/comments/appeals';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-05T12:00:00Z');
const DAY = 86_400_000;
const SECRET = 'unit-test-only-appeal-secret-0123456789';
const env = { UNSUBSCRIBE_SECRET: SECRET, ADMIN_LINK_BASE: 'https://s.example.test' };
const admin = { email: 'owner@example.test' };

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('COMMENTS_ENABLED', 'true');
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM items');
});

async function rejected(status = 'rejected') {
  const author = await person(db, NOW);
  await setLevel(db, author.id, 0);
  await db.query('UPDATE account_trust SET rejected = 1 WHERE account_id = $1', [author.id]);
  const id = await comment(db, await item(db), author.id, 'my rejected words', status);
  await db.query("UPDATE comments SET moderation_reason = 'Rude', decided_by = 'agent:moderator' WHERE id = $1", [id]);
  return { author, id, token: appealToken(SECRET, id, author.id, NOW)! };
}

describe('appeal tokens', () => {
  it('verify for the comment and author they were minted for, until 30 days pass', () => {
    const c = '11111111-1111-4111-8111-111111111111';
    const a = '22222222-2222-4222-8222-222222222222';
    const t = appealToken(SECRET, c, a, NOW)!;
    expect(verifyAppealToken(SECRET, t, NOW)).toEqual({ commentId: c, accountId: a });
    expect(verifyAppealToken(SECRET, t, new Date(NOW.getTime() + 30 * DAY - 1000))).toEqual({ commentId: c, accountId: a });
    expect(verifyAppealToken(SECRET, t, new Date(NOW.getTime() + 30 * DAY + 1000))).toBe('expired');
    expect(verifyAppealToken('another-secret-of-enough-length-000000', t, NOW)).toBe('invalid');
  });

  it('a forged comment or account id breaks the signature; no token without a strong secret', () => {
    const c = '11111111-1111-4111-8111-111111111111';
    const a = '22222222-2222-4222-8222-222222222222';
    const t = appealToken(SECRET, c, a, NOW)!;
    const forged = t.replace(a, '33333333-3333-4333-8333-333333333333');
    expect(verifyAppealToken(SECRET, forged, NOW)).toBe('invalid');
    expect(verifyAppealToken(SECRET, t.replace(c, a), NOW)).toBe('invalid');
    expect(verifyAppealToken(SECRET, 'junk', NOW)).toBe('invalid');
    expect(appealToken('short', c, a, NOW)).toBeNull();
  });
});

describe('fileAppeal', () => {
  it('files one appeal per comment, for its author only; a second is a duplicate', async () => {
    const r = await rejected();
    expect(await appealState(db, SECRET, r.token, NOW)).toBe('open');
    expect(await fileAppeal(db, SECRET, r.token, 'I was quoting the item', NOW)).toBe('filed');
    expect(await fileAppeal(db, SECRET, r.token, 'again', NOW)).toBe('duplicate');
    expect(await appealState(db, SECRET, r.token, NOW)).toBe('filed');
    const rows = await db.query('SELECT comment_id, account_id, note FROM comment_appeals');
    expect(rows.rows).toEqual([{ comment_id: r.id, account_id: r.author.id, note: 'I was quoting the item' }]);
  });

  it("refuses another account's token for this comment, expired tokens, notes over 300 and comments not rejected or hidden", async () => {
    const r = await rejected();
    const other = await person(db, NOW);
    expect(await fileAppeal(db, SECRET, appealToken(SECRET, r.id, other.id, NOW)!, 'mine now', NOW)).toBe('invalid');
    expect(await fileAppeal(db, SECRET, r.token, 'late', new Date(NOW.getTime() + 31 * DAY))).toBe('expired');
    expect(await fileAppeal(db, SECRET, r.token, 'x'.repeat(301), NOW)).toBe('invalid');
    const pub = await rejected('published');
    expect(await fileAppeal(db, SECRET, pub.token, 'why', NOW)).toBe('invalid');
    expect((await db.query('SELECT count(*)::int AS n FROM comment_appeals')).rows[0].n).toBe(0);
  });

  it('a hidden comment can be appealed; an empty note is allowed', async () => {
    const r = await rejected('hidden');
    expect(await fileAppeal(db, SECRET, r.token, '', NOW)).toBe('filed');
  });

  it('the GET state changes nothing', async () => {
    const r = await rejected();
    await appealState(db, SECRET, r.token, NOW);
    await appealState(db, SECRET, r.token, NOW);
    expect((await db.query('SELECT count(*)::int AS n FROM comment_appeals')).rows[0].n).toBe(0);
  });
});

describe('fileAppealRequest', () => {
  const post = (token: string, fields: Record<string, string>, origin = 'https://s.example.test') =>
    new Request(`https://s.example.test/comments/appeal/${token}/confirm/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin, host: 's.example.test', 'x-forwarded-for': '198.51.100.7' },
      body: new URLSearchParams(fields).toString(),
    });

  it('needs the same origin and the flags; forged ids in the form are ignored; redirects with an outcome only', async () => {
    const r = await rejected();
    const other = await rejected();
    expect((await fileAppealRequest(post(r.token, {}, 'https://evil.example'), { db, env, now: NOW }, r.token)).status).toBe(403);
    vi.stubEnv('COMMENTS_ENABLED', '');
    expect((await fileAppealRequest(post(r.token, {}), { db, env, now: NOW }, r.token)).status).toBe(404);
    vi.stubEnv('COMMENTS_ENABLED', 'true');
    const res = await fileAppealRequest(post(r.token, { note: 'please', comment: other.id, account: other.author.id }), { db, env, now: NOW }, r.token);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/comments/appeal/${r.token}/?a=filed#result`);
    const rows = await db.query('SELECT comment_id FROM comment_appeals');
    expect(rows.rows).toEqual([{ comment_id: r.id }]);
  });

  it('is rate limited per network address', async () => {
    const r = await rejected();
    const limiter = () => false;
    const res = await fileAppealRequest(post(r.token, { note: 'x' }), { db, env, now: NOW, limiter }, r.token);
    expect(res.status).toBe(429);
    expect((await db.query('SELECT count(*)::int AS n FROM comment_appeals')).rows[0].n).toBe(0);
  });
});

describe('decideAppeal', () => {
  it('overturn publishes, reverses the rejection in the counts and emails the author', async () => {
    const r = await rejected();
    await fileAppeal(db, SECRET, r.token, 'please', NOW);
    const out = await db.transaction((tx) => decideAppeal(tx, admin, r.id, 'overturn', NOW));
    expect(out).toMatchObject({ status: 'done', mail: { to: r.author.email } });
    if (out.status !== 'done') throw new Error('not done');
    expect(out.mail.text).toMatch(/published/i);
    expect(out.mail.text).not.toContain('owner@example.test');
    expect(await statusOf(db, r.id)).toBe('published');
    expect((await trustRow(db, r.author.id)).rejected).toBe(0);
    const row = await db.query('SELECT outcome, decided_at IS NOT NULL AS d FROM comment_appeals');
    expect(row.rows).toEqual([{ outcome: 'overturn', d: true }]);
    expect(await db.transaction((tx) => decideAppeal(tx, admin, r.id, 'uphold', NOW))).toEqual({ status: 'decided' });
  });

  it('uphold keeps the decision and emails the author', async () => {
    const r = await rejected();
    await fileAppeal(db, SECRET, r.token, 'please', NOW);
    const out = await db.transaction((tx) => decideAppeal(tx, admin, r.id, 'uphold', NOW));
    expect(out).toMatchObject({ status: 'done', mail: { to: r.author.email } });
    expect(await statusOf(db, r.id)).toBe('rejected');
    expect((await trustRow(db, r.author.id)).rejected).toBe(1);
  });

  it('no appeal, a deleted comment or an author who deleted it meanwhile: nothing changes', async () => {
    const r = await rejected();
    expect(await db.transaction((tx) => decideAppeal(tx, admin, r.id, 'overturn', NOW))).toEqual({ status: 'not_found' });
    await fileAppeal(db, SECRET, r.token, 'please', NOW);
    await db.query("UPDATE comments SET status = 'deleted', body = '' WHERE id = $1", [r.id]);
    expect(await db.transaction((tx) => decideAppeal(tx, admin, r.id, 'overturn', NOW))).toEqual({ status: 'gone' });
    expect(await statusOf(db, r.id)).toBe('deleted');
  });
});
