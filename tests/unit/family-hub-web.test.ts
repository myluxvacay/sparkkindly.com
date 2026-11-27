// @vitest-environment node
// Family Hub POSTs: Origin first, the account only from the session, and a circle id in the
// path buys a non-member nothing. A child ("playing as") context is refused.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { createChildProfile } from '@/lib/accounts/children';
import { getContext, switchToProfile } from '@/lib/accounts/context';
import { createCircleRequest, createKidRequest, runActRequest } from '@/lib/family-hub/web';
import { createCircle, createEvent, myCircles } from '@/lib/family-hub/repo';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-27T12:00:00Z');
const HEAD = {
  host: 'staging.sparkkindly.com',
  origin: 'https://staging.sparkkindly.com',
  'content-type': 'application/x-www-form-urlencoded',
};
let n = 0;

beforeAll(async () => {
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  db = await newTestDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.close();
});

const post = (body: Record<string, string>, opts: { cookie?: string; origin?: string | null } = {}) => {
  const headers: Record<string, string> = { ...HEAD };
  if (opts.origin === null) delete headers.origin;
  else if (opts.origin) headers.origin = opts.origin;
  if (opts.cookie) headers.cookie = `__Host-sk_account=${opts.cookie}`;
  return new Request('http://localhost/x', { method: 'POST', headers, body: new URLSearchParams(body).toString() });
};

async function account(): Promise<{ id: string; email: string; session: string }> {
  const email = `hubweb${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth: '1990-05-05' }, NOW);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, NOW))!, NOW))!;
  return { id: r.accountId, email, session };
}

describe('family hub web handlers', () => {
  it('create circle: no Origin is 403; a signed-in adult is redirected to the new circle', async () => {
    const a = await account();
    const bad = await createCircleRequest(post({ name: 'Fam' }, { cookie: a.session, origin: null }), { db, now: NOW });
    expect(bad.status).toBe(403);
    const ok = await createCircleRequest(post({ name: 'The Web Family', time_zone: 'America/New_York' }, { cookie: a.session }), { db, now: NOW });
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toMatch(/^\/family\/[0-9a-f-]{36}\/$/);
    expect((await myCircles(db, a.id)).length).toBe(1);
  });

  it('no session goes to sign-in', async () => {
    const r = await createCircleRequest(post({ name: 'Fam' }), { db, now: NOW });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/account/sign-in/');
  });

  it('a non-member POSTing to another circle changes nothing', async () => {
    const a = await account();
    const b = await account();
    const c = await createCircle(db, a.id, 'Private Family', 'UTC');
    if (typeof c !== 'object' || c === null) throw new Error('circle failed');
    const r = await createKidRequest(
      post({ first_name: 'Nope', age_group: '6-8', avatar_id: 'spark', colour: 'teal', phone: '' }, { cookie: b.session }),
      { db, now: NOW },
      c.id,
    );
    expect(r.headers.get('location')).toContain('r=no');
    const kids = await db.query('SELECT 1 FROM hub_kid_profiles WHERE circle_id = $1', [c.id]);
    expect(kids.rows.length).toBe(0);
  });

  it('run actions through the web layer honour membership', async () => {
    const a = await account();
    const b = await account();
    const c = await createCircle(db, a.id, 'Run Family', 'UTC');
    if (typeof c !== 'object' || c === null) throw new Error('circle failed');
    const ev = await createEvent(db, c.id, a.id, {
      title: 'Pickup', startsAt: new Date('2026-11-27T20:00:00Z'), endsAt: new Date('2026-11-27T20:30:00Z'),
      recurrence: null, recurrenceUntil: null, location: 'School', notes: null, isRun: true,
      driverUserId: null, memberIds: [], kidIds: [],
    });
    if (typeof ev !== 'object' || ev === null) throw new Error('event failed');
    const denied = await runActRequest(post({ event_id: ev.id, action: 'claim' }, { cookie: b.session }), { db, now: NOW }, c.id);
    expect(denied.headers.get('location')).toContain('r=run-no');
    const ok = await runActRequest(post({ event_id: ev.id, action: 'claim' }, { cookie: a.session }), { db, now: NOW }, c.id);
    expect(ok.headers.get('location')).toContain('r=run-ok');
  });

  it('a child context is refused (403)', async () => {
    const a = await account();
    const p = await createChildProfile(db, a.id, { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: 'on', pin: '1234' }, NOW);
    if (p.status !== 'created') throw new Error('profile failed');
    expect(await switchToProfile(db, a.session, p.profileId, NOW)).toBe(true);
    expect((await getContext(db, a.session, NOW))?.profile).not.toBeNull();
    const r = await createCircleRequest(post({ name: 'Fam' }, { cookie: a.session }), { db, now: NOW });
    expect(r.status).toBe(403);
  });
});
