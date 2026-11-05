// @vitest-environment node
// Circle reports and admin hide (plan 4D Task 2): any current member with join_circle may report their own circle (5 a
// day); a child context cannot; reports survive the reporter's deletion; admin hides and restores a circle (audited) and
// a hidden circle disappears for members everywhere until restored.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { fixtures, item, type Fixtures } from '../helpers/circle-play';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { createChildProfile } from '@/lib/accounts/children';
import { switchToProfile } from '@/lib/accounts/context';
import { handleAdminAction } from '@/lib/admin/act';
import { runAction } from '@/lib/admin/actions';
import { createCircle, getCircleForMember, listMyCircles } from '@/lib/circles/repo';
import { listCommunities } from '@/lib/circles/communities';
import { circleForViewer } from '@/lib/circles/daily-set';
import { getTallies } from '@/lib/circles/scores';
import { createLinkInvite, listInvites, previewInvite } from '@/lib/circles/invites';
import { dailyMailFor } from '@/lib/circles/mail';
import { REPORT_LIMIT, listReportedCircles, reportCircle, reportCircleRequest } from '@/lib/circles/reports';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let f: Fixtures;
const NOW = new Date('2026-11-05T12:00:00Z');
const ADMIN = { email: 'owner@example.test' };
const HEAD = { host: 'staging.sparkkindly.com', origin: 'https://staging.sparkkindly.com', 'content-type': 'application/x-www-form-urlencoded' };
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
  f = await fixtures(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('CIRCLES_ENABLED', 'true');
  await db.query('DELETE FROM circles');
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM audit_log');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function account(dateOfBirth = '1990-05-05') {
  const email = `rep${n++}@example.test`;
  const teen = dateOfBirth > '2008-01-01';
  const r = await signUp(db, { email, dateOfBirth, ...(teen ? { parentEmail: 'parent@example.test' } : {}) }, NOW);
  if (r.status !== 'created') throw new Error('sign-up failed');
  await db.query("UPDATE accounts SET verified_at = '2026-11-01', notify_daily_set = true WHERE id = $1", [r.accountId]);
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, NOW))!, NOW))!;
  return { id: r.accountId, email, session };
}
async function circle(owner: string, kind = 'friends') {
  const r = await createCircle(db, owner, { name: 'Home', kind, yourName: 'Olly', description: kind === 'community' ? 'Fun' : undefined }, NOW);
  if (r.status !== 'created') throw new Error(`create failed: ${r.status}`);
  const id = (await db.query<{ id: string }>('SELECT id FROM circles WHERE slug = $1', [r.slug])).rows[0].id;
  return { slug: r.slug, id };
}
const join = (slug: string, accountId: string, name = 'Bea') =>
  db.query('INSERT INTO circle_members (circle_id, account_id, display_name) SELECT id, $2, $3 FROM circles WHERE slug = $1', [slug, accountId, name]);
const post = (body: Record<string, string>, cookie?: string) =>
  new Request('http://localhost/x', {
    method: 'POST',
    headers: { ...HEAD, ...(cookie ? { cookie: `__Host-sk_account=${cookie}` } : {}) },
    body: new URLSearchParams(body).toString(),
  });
const act = (name: string, id: string) => runAction(db, ADMIN, name, new URLSearchParams({ id }), NOW);

describe('reportCircle', () => {
  it('a current member reports with a reason and an optional note; nothing about members is stored', async () => {
    const owner = await account();
    const c = await circle(owner.id);
    expect(await reportCircle(db, owner.id, c.slug, { reason: 'behaviour', note: '  Someone is rude  ' }, NOW)).toBe('reported');
    expect(await reportCircle(db, owner.id, c.slug, { reason: 'name' }, NOW)).toBe('reported');
    const rows = (await db.query('SELECT circle_id, reporter_account_id, reason, note FROM circle_reports ORDER BY id')).rows;
    expect(rows).toEqual([
      { circle_id: c.id, reporter_account_id: owner.id, reason: 'behaviour', note: 'Someone is rude' },
      { circle_id: c.id, reporter_account_id: owner.id, reason: 'name', note: null },
    ]);
  });

  it('a non-member, a left member and a member of another circle cannot report it', async () => {
    const owner = await account();
    const c = await circle(owner.id);
    const stranger = await account();
    const left = await account();
    await join(c.slug, left.id);
    await db.query('UPDATE circle_members SET left_at = now() WHERE account_id = $1', [left.id]);
    const other = await circle(stranger.id);
    expect(other.slug).not.toBe(c.slug);
    for (const who of [stranger.id, left.id]) expect(await reportCircle(db, who, c.slug, { reason: 'safety' }, NOW)).toBe('not_member');
    expect(await reportCircle(db, owner.id, 'zzzzzzzzzz', { reason: 'safety' }, NOW)).toBe('not_member');
    expect(await reportCircle(db, owner.id, 'not a slug', { reason: 'safety' }, NOW)).toBe('not_member');
  });

  it('an account without join_circle (13-15 consent pending) cannot report', async () => {
    const owner = await account();
    const c = await circle(owner.id);
    const teen = await account('2012-01-01');
    await db.query("UPDATE accounts SET consent_state = 'pending' WHERE id = $1", [teen.id]);
    await join(c.slug, teen.id);
    expect(await reportCircle(db, teen.id, c.slug, { reason: 'other' }, NOW)).toBe('not_allowed');
  });

  it('rejects an unknown reason, a note over 300 characters and a control character', async () => {
    const owner = await account();
    const c = await circle(owner.id);
    for (const input of [{ reason: 'spam' }, { reason: undefined }, { reason: 'other', note: 'x'.repeat(301) }, { reason: 'other', note: 'a\u0000b' }, { reason: 'other', note: 5 }]) {
      expect(await reportCircle(db, owner.id, c.slug, input, NOW), JSON.stringify(input)).toBe('invalid');
    }
    expect(await reportCircle(db, owner.id, c.slug, { reason: 'other', note: 'x'.repeat(300) }, NOW)).toBe('reported');
  });

  it(`allows ${'5'} reports a day per account`, async () => {
    const owner = await account();
    const c = await circle(owner.id);
    for (let i = 0; i < REPORT_LIMIT; i++) expect(await reportCircle(db, owner.id, c.slug, { reason: 'other' }, NOW)).toBe('reported');
    expect(await reportCircle(db, owner.id, c.slug, { reason: 'other' }, NOW)).toBe('limit');
    expect(await reportCircle(db, owner.id, c.slug, { reason: 'other' }, new Date(NOW.getTime() + 86_400_001))).toBe('reported');
  });

  it('the report survives the reporter’s deletion, without the reporter', async () => {
    const owner = await account();
    const c = await circle(owner.id);
    const bea = await account();
    await join(c.slug, bea.id);
    await reportCircle(db, bea.id, c.slug, { reason: 'safety', note: 'help' }, NOW);
    await db.query('DELETE FROM accounts WHERE id = $1', [bea.id]);
    expect((await db.query('SELECT reporter_account_id, reason, note FROM circle_reports')).rows).toEqual([
      { reporter_account_id: null, reason: 'safety', note: 'help' },
    ]);
  });
});

describe('reportCircleRequest', () => {
  it('a member posts and comes back to the circle; a child context gets 403; flags off is a 404', async () => {
    const owner = await account();
    const c = await circle(owner.id, 'family');
    const r = await reportCircleRequest(post({ reason: 'name', note: 'odd' }, owner.session), { db, now: NOW, limit: () => true }, c.slug);
    expect([r.status, r.headers.get('location')]).toEqual([303, `/circles/${c.slug}/?r=reported#result`]);
    const bad = await reportCircleRequest(post({ reason: 'nope' }, owner.session), { db, now: NOW, limit: () => true }, c.slug);
    expect(bad.headers.get('location')).toBe(`/circles/${c.slug}/?r=report-invalid#result`);
    const p = await createChildProfile(db, owner.id, { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, NOW);
    if (p.status !== 'created') throw new Error('profile');
    expect(await switchToProfile(db, owner.session, p.profileId, NOW)).toBe(true);
    expect((await reportCircleRequest(post({ reason: 'name' }, owner.session), { db, now: NOW, limit: () => true }, c.slug)).status).toBe(403);
    vi.stubEnv('CIRCLES_ENABLED', '');
    expect((await reportCircleRequest(post({ reason: 'name' }, owner.session), { db, now: NOW }, c.slug)).status).toBe(404);
    expect((await db.query('SELECT count(*)::int AS n FROM circle_reports')).rows[0].n).toBe(1);
  });
});

describe('admin: reported circles, hide, restore, handled', () => {
  it('lists counts, open count, latest note and status, never an address', async () => {
    const owner = await account();
    const c = await circle(owner.id);
    await reportCircle(db, owner.id, c.slug, { reason: 'name', note: 'first' }, NOW);
    await reportCircle(db, owner.id, c.slug, { reason: 'safety', note: 'second' }, new Date(NOW.getTime() + 1000));
    const list = await listReportedCircles(db);
    expect(list).toEqual([
      expect.objectContaining({ id: c.id, name: 'Home', total: 2, open: 2, latestReason: 'safety', latestNote: 'second', hidden: false }),
    ]);
    expect(JSON.stringify(list)).not.toContain('@');
  });

  it('hide, restore and reports_handled are audited and validated', async () => {
    const owner = await account();
    const c = await circle(owner.id);
    await reportCircle(db, owner.id, c.slug, { reason: 'name' }, NOW);
    expect(await act('circle.hide', c.id)).toMatchObject({ ok: true, code: 'circle_hidden' });
    expect(await act('circle.hide', c.id)).toMatchObject({ ok: false, code: 'not_found' });
    expect(await act('circle.reports_handled', c.id)).toMatchObject({ ok: true, code: 'circle_reports_handled' });
    expect((await listReportedCircles(db))[0]).toMatchObject({ open: 0, total: 1, hidden: true });
    expect(await act('circle.restore', c.id)).toMatchObject({ ok: true, code: 'circle_restored' });
    expect(await act('circle.restore', 'not-a-uuid')).toMatchObject({ ok: false, code: 'not_found' });
    const audits = (await db.query<{ action: string; target: string }>('SELECT action, target FROM audit_log ORDER BY id')).rows;
    expect(audits).toEqual([
      { action: 'circle.hide', target: `circle:${c.id}` },
      { action: 'circle.reports_handled', target: `circle:${c.id}` },
      { action: 'circle.restore', target: `circle:${c.id}` },
    ]);
  });

  it('the admin route needs an admin session (and CSRF) before any circle action runs', async () => {
    const owner = await account();
    const c = await circle(owner.id);
    const r = await handleAdminAction(
      new Request('http://localhost/admin/act/', { method: 'POST', headers: HEAD, body: new URLSearchParams({ action: 'circle.hide', id: c.id }).toString() }),
      { db, env: {}, now: NOW },
    );
    expect([r.status, r.headers.get('location')]).toEqual([303, '/admin/sign-in/']);
    expect((await db.query('SELECT hidden_at FROM circles WHERE id = $1', [c.id])).rows[0].hidden_at).toBeNull();
  });
});

describe('a hidden circle disappears for members and returns on restore', () => {
  it('page, list, set, scores, invites, communities and mail', async () => {
    await item(db, { world: f.worlds.a });
    const owner = await account();
    const c = await circle(owner.id, 'community');
    const bea = await account();
    await join(c.slug, bea.id);
    const link = await createLinkInvite(db, owner.id, c.slug, NOW);
    if (link.status !== 'created') throw new Error('link');
    const at = new Date('2026-11-05T08:00:00Z');
    const links = { base: 'https://x.test', secret: 'test-only-unsubscribe-secret-0123456789abcdef' };
    const visible = async () => [
      (await getCircleForMember(db, bea.id, c.slug)) !== null,
      (await listMyCircles(db, bea.id)).length === 1,
      (await circleForViewer(db, bea.id, null, c.slug)) !== null,
      (await getTallies(db, bea.id, null, c.slug, NOW)) !== null,
      (await listInvites(db, owner.id, c.slug, NOW, null)) !== null,
      (await previewInvite(db, link.token, NOW)) !== null,
      (await listCommunities(db, 1)).some((x) => x.slug === c.slug),
      (await dailyMailFor(db, at, { mails: 200, circles: 50 }, links)).length === 1,
    ];
    expect(await visible()).toEqual(Array(8).fill(true));
    await act('circle.hide', c.id);
    expect(await visible()).toEqual(Array(8).fill(false));
    await act('circle.restore', c.id);
    expect(await visible()).toEqual(Array(8).fill(true));
  });
});
