// @vitest-environment node
// The report POST and form (plan 7B Task 4): same origin, the adult context only (a child context gets 403, no session
// goes to sign-in), the reporter taken from the session (ids in the form are ignored), the daily limit, the flags, and
// the per-comment report form in the comment list (no JavaScript; urgent is its own labelled checkbox).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { newTestDb } from '../helpers/test-db';
import { comment, item, person, setLevel, statusOf } from '../helpers/comments';
import { seedReference } from '@/db/seed';
import { createChildProfile } from '@/lib/accounts/children';
import { switchToProfile } from '@/lib/accounts/context';
import type { EmailMessage } from '@/lib/email';
import { reportCommentRequest } from '@/lib/comments/report-web';
import { COMMENT_MESSAGES, loadCommentSection } from '@/lib/comments/web';
import { REPORT_LIMIT } from '@/lib/comments/reports';
import CommentSection from '@/components/comments/CommentSection';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-05T12:00:00Z');
const ORIGIN = { host: 'sparkkindly.com', origin: 'https://sparkkindly.com' };
const env = { ADMIN_EMAILS: 'owner@example.test' };
let sent: EmailMessage[] = [];
const deps = () => ({ db, now: NOW, env, send: async (m: EmailMessage) => void sent.push(m) });

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  sent = [];
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('COMMENTS_ENABLED', 'true');
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM items');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const req = (fields: Record<string, string>, session?: string, headers: Record<string, string> = ORIGIN) =>
  new Request('http://localhost/comments/report/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers, ...(session ? { cookie: `__Host-sk_account=${session}` } : {}) },
    body: new URLSearchParams(fields).toString(),
  });

async function target() {
  const author = await person(db, NOW);
  const it = await item(db);
  const slug = (await db.query<{ s: string }>('SELECT slug AS s FROM items WHERE id = $1', [it])).rows[0].s;
  return { author, it, path: `/play/${slug}/`, id: await comment(db, it, author.id, 'reported words') };
}

describe('reportCommentRequest', () => {
  it('reports as the signed-in account and redirects to the item with an outcome code only', async () => {
    const t = await target();
    const r = await person(db, NOW);
    const forged = await person(db, NOW);
    const res = await reportCommentRequest(req({ comment: t.id, reason: 'abuse', note: 'mean', account: forged.id, reporter: forged.id }, r.session), deps());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${t.path}?c=reported#result`);
    const rows = await db.query('SELECT reporter_account_id AS who FROM comment_reports');
    expect(rows.rows).toEqual([{ who: r.id }]);
    expect(COMMENT_MESSAGES.reported.ok).toBe(true);
  });

  it('refuses a foreign Origin (403), sends no session to sign-in, gives a child context 403; nothing is stored', async () => {
    const t = await target();
    const r = await person(db, NOW);
    expect((await reportCommentRequest(req({ comment: t.id, reason: 'abuse' }, r.session, { host: 'sparkkindly.com', origin: 'https://evil.example' }), deps())).status).toBe(403);
    const anon = await reportCommentRequest(req({ comment: t.id, reason: 'abuse' }), deps());
    expect(anon.status).toBe(303);
    expect(anon.headers.get('location')).toMatch(/sign-in/);
    const kid = await createChildProfile(db, r.id, { displayName: 'Kid', ageBand: '10-12', guardianConfirmed: 'on', pin: '4826' }, NOW);
    if (kid.status !== 'created') throw new Error('profile failed');
    await switchToProfile(db, r.session, kid.profileId, NOW);
    expect((await reportCommentRequest(req({ comment: t.id, reason: 'abuse' }, r.session), deps())).status).toBe(403);
    expect((await db.query('SELECT count(*)::int AS n FROM comment_reports')).rows[0].n).toBe(0);
  });

  it('is a 404 with the flags off', async () => {
    vi.stubEnv('COMMENTS_ENABLED', '');
    const t = await target();
    const r = await person(db, NOW);
    expect((await reportCommentRequest(req({ comment: t.id, reason: 'abuse' }, r.session), deps())).status).toBe(404);
  });

  it('an urgent report from a level-1 member hides the comment and emails the owner counts only', async () => {
    const t = await target();
    const r = await person(db, NOW);
    await setLevel(db, r.id, 1);
    const res = await reportCommentRequest(req({ comment: t.id, reason: 'personal_info', urgent: 'on', note: 'names a child' }, r.session), deps());
    expect(res.headers.get('location')).toBe(`${t.path}?c=report_hidden#result`);
    expect(await statusOf(db, t.id)).toBe('hidden');
    expect(sent.map((m) => m.to)).toEqual(['owner@example.test']);
    expect(JSON.stringify(sent)).not.toMatch(/reported words|names a child/);
  });

  it('refusals come back as codes: own comment, duplicate, invalid, unknown comment, the daily limit', async () => {
    const t = await target();
    const r = await person(db, NOW);
    const code = async (fields: Record<string, string>, session = r.session) =>
      new URL((await reportCommentRequest(req(fields, session), deps())).headers.get('location')!, 'http://x').searchParams.get('c');
    expect(await code({ comment: t.id, reason: 'abuse' }, t.author.session)).toBe('report_own');
    expect(await code({ comment: t.id, reason: 'abuse' })).toBe('reported');
    expect(await code({ comment: t.id, reason: 'abuse' })).toBe('report_duplicate');
    expect(await code({ comment: t.id, reason: 'nope' })).toBe('report_invalid');
    expect(await code({ comment: '00000000-0000-4000-8000-000000000000', reason: 'abuse' })).toBe('report_not_found');
    for (let i = 1; i < REPORT_LIMIT; i++) await code({ comment: await comment(db, t.it, t.author.id, `w${i}`), reason: 'abuse' });
    expect(await code({ comment: await comment(db, t.it, t.author.id, 'one more'), reason: 'abuse' })).toBe('report_limit');
    for (const c of ['report_own', 'report_duplicate', 'report_invalid', 'report_not_found', 'report_limit', 'report_hidden']) {
      expect(COMMENT_MESSAGES[c], c).toBeDefined();
    }
  });
});

describe('the report form in the comment list', () => {
  it("shows a no-JavaScript report form under other members' comments only, with urgent as its own labelled checkbox", async () => {
    const t = await target();
    const viewer = await person(db, NOW);
    await comment(db, t.it, viewer.id, 'my own words');
    const data = (await loadCommentSection(db, viewer.session, t.it, NOW))!;
    const html = renderToStaticMarkup(<CommentSection data={data} />);
    expect(html.match(/action="\/comments\/report\/"/g)).toHaveLength(1);
    expect(html).toContain(`name="comment" value="${t.id}"`);
    expect(html).toMatch(/<details[^>]*><summary>Report<\/summary>/);
    expect(html).toMatch(new RegExp(`<input[^>]*type="checkbox"[^>]*id="report-urgent-${t.id}"`));
    expect(html).toContain(`for="report-urgent-${t.id}"`);
    expect(html).toContain(`for="report-reason-${t.id}"`);
    expect(html).not.toContain('<script');
  });

  it('anonymous visitors and banned members get no report form', async () => {
    const t = await target();
    const anon = (await loadCommentSection(db, undefined, t.it, NOW))!;
    expect(renderToStaticMarkup(<CommentSection data={anon} />)).not.toContain('/comments/report/');
    const banned = await person(db, NOW);
    await setLevel(db, banned.id, 0);
    await db.query('UPDATE account_trust SET banned = true WHERE account_id = $1', [banned.id]);
    const data = (await loadCommentSection(db, banned.session, t.it, NOW))!;
    expect(renderToStaticMarkup(<CommentSection data={data} />)).not.toContain('/comments/report/');
  });
});
