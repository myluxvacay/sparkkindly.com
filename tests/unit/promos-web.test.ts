// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { createChildProfile } from '@/lib/accounts/children';
import { getContext, switchToProfile } from '@/lib/accounts/context';
import { enterPromoRequest } from '@/lib/promos/enter-web';
import { createPromo, getEntry, getLivePromo } from '@/lib/promos/repo';

// The entry POST (lib/promos/enter-web.ts): the account comes from the session only, and the gates are the
// session kind (a child profile can never enter), the account's own age group (a 17-year-old cannot attest
// their way in) and the explicit attestation itself.

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-21T12:00:00Z');
let n = 0;

const HEAD = {
  host: 'staging.sparkkindly.com',
  origin: 'https://staging.sparkkindly.com',
  'content-type': 'application/x-www-form-urlencoded',
};
const post = (body: string, opts: { cookie?: string; origin?: string | null } = {}) => {
  const headers: Record<string, string> = { ...HEAD };
  if (opts.origin === null) delete headers.origin;
  else if (opts.origin) headers.origin = opts.origin;
  if (opts.cookie) headers.cookie = `__Host-sk_account=${opts.cookie}`;
  return new Request('http://localhost/promos/spark-streak/enter/', { method: 'POST', headers, body });
};
const where = (r: Response) => [r.status, r.headers.get('location')];
const deps = () => ({ db, now: NOW, limit: () => true });

async function account(dob: string): Promise<{ accountId: string; session: string }> {
  const email = `w${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth: dob, parentEmail: 'parent@example.test' }, NOW);
  if (r.status !== 'created') throw new Error(`sign-up failed: ${r.status}`);
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, NOW))!, NOW))!;
  return { accountId: r.accountId, session };
}

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});

afterAll(async () => {
  await db.close();
});

describe('enterPromoRequest', () => {
  it('a signed-out visitor is sent to sign in', async () => {
    expect(where(await enterPromoRequest(post('attest=yes'), 'spark-streak', deps()))).toEqual([
      303,
      '/account/sign-in/',
    ]);
  });

  it('a malformed slug is never reflected into a redirect', async () => {
    const a = await account('1990-05-05');
    expect(where(await enterPromoRequest(post('attest=yes', { cookie: a.session }), 'BAD SLUG!', deps()))).toEqual([
      303,
      '/promos/',
    ]);
  });

  it('entry against a draft promotion is closed', async () => {
    await createPromo(db, {
      slug: 'draft-promo',
      type: 'streak_draw',
      title: 'Draft promo',
      shortDescription: 'Not live.',
      body: '',
      rules: '',
      prize: '',
      startsOn: null,
      endsOn: null,
      config: { targetDays: 10, freezeAllowance: 1, winnersPerDraw: 5 },
    });
    const a = await account('1990-05-05');
    expect(where(await enterPromoRequest(post('attest=yes', { cookie: a.session }), 'draft-promo', deps()))).toEqual([
      303,
      '/promos/draft-promo/?r=closed#entry',
    ]);
  });

  it('a cross-origin post is refused outright', async () => {
    const a = await account('1990-05-05');
    const r = await enterPromoRequest(post('attest=yes', { cookie: a.session, origin: 'https://evil.example' }), 'spark-streak', deps());
    expect(r.status).toBe(403);
  });

  it('an adult holder who attests is entered, once', async () => {
    const a = await account('1990-05-05');
    expect(where(await enterPromoRequest(post('attest=yes', { cookie: a.session }), 'spark-streak', deps()))).toEqual([
      303,
      '/promos/spark-streak/?r=entered#entry',
    ]);
    const promo = await getLivePromo(db, 'spark-streak', NOW);
    const entry = await getEntry(db, promo!.id, a.accountId);
    expect(entry?.attestedAdult).toBe(true);
    expect(where(await enterPromoRequest(post('attest=yes', { cookie: a.session }), 'spark-streak', deps()))).toEqual([
      303,
      '/promos/spark-streak/?r=already#entry',
    ]);
  });

  it('without the attestation tick, no entry is recorded', async () => {
    const a = await account('1985-01-01');
    expect(where(await enterPromoRequest(post('', { cookie: a.session }), 'spark-streak', deps()))).toEqual([
      303,
      '/promos/spark-streak/?r=attest#entry',
    ]);
    const promo = await getLivePromo(db, 'spark-streak', NOW);
    expect(await getEntry(db, promo!.id, a.accountId)).toBeNull();
  });

  it('a 17-year-old account cannot attest its way in', async () => {
    const teen = await account('2009-06-01'); // 17 at NOW
    expect((await getContext(db, teen.session, NOW))?.account.ageGroup).toBe('teen_16_17');
    expect(where(await enterPromoRequest(post('attest=yes', { cookie: teen.session }), 'spark-streak', deps()))).toEqual([
      303,
      '/promos/spark-streak/?r=grownups#entry',
    ]);
  });

  it('a child profile session can never enter, even on an adult account', async () => {
    const a = await account('1990-05-05');
    const child = await createChildProfile(
      db,
      a.accountId,
      { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: true, pin: '1234' },
      NOW,
    );
    if (child.status !== 'created') throw new Error('profile failed');
    expect(await switchToProfile(db, a.session, child.profileId, NOW)).toBe(true);
    expect(where(await enterPromoRequest(post('attest=yes', { cookie: a.session }), 'spark-streak', deps()))).toEqual([
      303,
      '/promos/spark-streak/?r=grownups#entry',
    ]);
    const promo = await getLivePromo(db, 'spark-streak', NOW);
    expect(await getEntry(db, promo!.id, a.accountId)).toBeNull();
  });
});
