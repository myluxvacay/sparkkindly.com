// @vitest-environment node
// Family Hub Phase 2 POSTs: the parent handlers behave like Phase 1 (Origin first, account
// from the session, membership inside), and the kid view is a separate credential entirely —
// a kid cookie buys nothing on a parent route, an account cookie buys nothing on a kid
// route, and one kid's cookie does not open another kid's view.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { createCircle, createKid } from '@/lib/family-hub/repo';
import { createChore } from '@/lib/family-hub/loops';
import { createChoreRequest, kidPinRequest } from '@/lib/family-hub/web-loops';
import { enterKidViewRequest, kidActRequest } from '@/lib/family-hub/web-kid';
import { KID_COOKIE } from '@/lib/family-hub/kid-session';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-27T17:00:00Z');
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

const post = (body: Record<string, string>, opts: { cookie?: string; kidCookie?: string; origin?: string | null } = {}) => {
  const headers: Record<string, string> = { ...HEAD };
  if (opts.origin === null) delete headers.origin;
  else if (opts.origin) headers.origin = opts.origin;
  const cookies: string[] = [];
  if (opts.cookie) cookies.push(`__Host-sk_account=${opts.cookie}`);
  if (opts.kidCookie) cookies.push(`${KID_COOKIE}=${opts.kidCookie}`);
  if (cookies.length) headers.cookie = cookies.join('; ');
  return new Request('http://localhost/x', { method: 'POST', headers, body: new URLSearchParams(body).toString() });
};

async function account(): Promise<{ id: string; email: string; session: string }> {
  const email = `hub2web${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth: '1990-05-05' }, NOW);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, NOW))!, NOW))!;
  return { id: r.accountId, email, session };
}

async function familyOf(a: { id: string }): Promise<{ circleId: string; kidId: string }> {
  const c = await createCircle(db, a.id, 'Web Family', 'America/New_York');
  if (typeof c !== 'object') throw new Error('circle failed');
  const kid = await createKid(db, c.id, a.id, { firstName: 'Sam', ageGroup: '6-8', avatarId: 'dog', colour: 'teal', phone: null });
  if (typeof kid !== 'object' || kid === null || !('id' in kid)) throw new Error('kid failed');
  return { circleId: c.id, kidId: kid.id };
}

const kidTokenOf = (res: Response): string => {
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = new RegExp(`${KID_COOKIE}=([0-9a-f]+)`).exec(setCookie);
  if (!m) throw new Error(`no kid cookie in: ${setCookie}`);
  return m[1];
};

describe('parent handlers (Phase 2)', () => {
  it('create chore: no Origin is 403; the owner succeeds; a stranger is refused', async () => {
    const a = await account();
    const b = await account();
    const { circleId, kidId } = await familyOf(a);
    const body = { kid_id: kidId, title: 'Feed the cat', cadence: 'daily', points: '10' };
    const bad = await createChoreRequest(post(body, { cookie: a.session, origin: null }), { db, now: NOW }, circleId);
    expect(bad.status).toBe(403);
    const ok = await createChoreRequest(post(body, { cookie: a.session }), { db, now: NOW }, circleId);
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toContain('r=added');
    const stranger = await createChoreRequest(post(body, { cookie: b.session }), { db, now: NOW }, circleId);
    expect(stranger.headers.get('location')).toContain('r=no');
  });

  it('the PIN handler sets a kid-view PIN for a member only', async () => {
    const a = await account();
    const b = await account();
    const { circleId, kidId } = await familyOf(a);
    const ok = await kidPinRequest(post({ kid_id: kidId, action: 'set', pin: '1357' }, { cookie: a.session }), { db, now: NOW }, circleId);
    expect(ok.headers.get('location')).toContain('r=pin-ok');
    const stranger = await kidPinRequest(post({ kid_id: kidId, action: 'set', pin: '9999' }, { cookie: b.session }), { db, now: NOW }, circleId);
    expect(stranger.headers.get('location')).toContain('r=pin-no');
  });
});

describe('kid view handlers: a separate credential', () => {
  it('PIN entry mints the kid cookie; the kid can then mark a chore', async () => {
    const a = await account();
    const { circleId, kidId } = await familyOf(a);
    const chore = await createChore(db, circleId, a.id, { kidProfileId: kidId, title: 'Feed the cat', cadence: 'daily', points: 10 });
    if (typeof chore !== 'object' || chore === null) throw new Error('chore failed');
    await kidPinRequest(post({ kid_id: kidId, action: 'set', pin: '1357' }, { cookie: a.session }), { db, now: NOW }, circleId);

    const wrong = await enterKidViewRequest(post({ pin: '0000' }), { db, now: NOW }, circleId, kidId);
    expect(wrong.headers.get('location')).toContain('r=wrong');
    expect(wrong.headers.get('set-cookie')).toBeNull();

    const entered = await enterKidViewRequest(post({ pin: '1357' }), { db, now: NOW }, circleId, kidId);
    expect(entered.status).toBe(303);
    const token = kidTokenOf(entered);

    const marked = await kidActRequest(post({ action: 'mark', chore_id: chore.id }, { kidCookie: token }), { db, now: NOW }, circleId, kidId);
    expect(marked.headers.get('location')).toContain('r=marked');
  });

  it('a kid cookie buys nothing on a parent route, and an account cookie buys nothing on a kid route', async () => {
    const a = await account();
    const { circleId, kidId } = await familyOf(a);
    await kidPinRequest(post({ kid_id: kidId, action: 'set', pin: '1357' }, { cookie: a.session }), { db, now: NOW }, circleId);
    const entered = await enterKidViewRequest(post({ pin: '1357' }), { db, now: NOW }, circleId, kidId);
    const token = kidTokenOf(entered);

    // Parent route with ONLY the kid cookie: the account gate sends it to sign-in.
    const parentTry = await createChoreRequest(
      post({ kid_id: kidId, title: 'Sneaky', cadence: 'daily', points: '1' }, { kidCookie: token }),
      { db, now: NOW }, circleId,
    );
    expect(parentTry.headers.get('location')).toContain('/account/sign-in/');

    // Kid route with ONLY the account cookie: forbidden — kid routes never read it.
    const kidTry = await kidActRequest(post({ action: 'mark', chore_id: kidId }, { cookie: a.session }), { db, now: NOW }, circleId, kidId);
    expect(kidTry.status).toBe(403);
  });

  it("one kid's cookie does not open a sibling's view", async () => {
    const a = await account();
    const { circleId, kidId } = await familyOf(a);
    const sibling = await createKid(db, circleId, a.id, { firstName: 'Jo', ageGroup: '9-12', avatarId: 'fox', colour: 'blue', phone: null });
    if (typeof sibling !== 'object' || sibling === null || !('id' in sibling)) throw new Error('kid failed');
    await kidPinRequest(post({ kid_id: kidId, action: 'set', pin: '1357' }, { cookie: a.session }), { db, now: NOW }, circleId);
    const entered = await enterKidViewRequest(post({ pin: '1357' }), { db, now: NOW }, circleId, kidId);
    const token = kidTokenOf(entered);
    const cross = await kidActRequest(post({ action: 'mark', chore_id: kidId }, { kidCookie: token }), { db, now: NOW }, circleId, sibling.id);
    expect(cross.status).toBe(403);
  });
});
