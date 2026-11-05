// @vitest-environment node
// Circle set, scores and interests pages (plan 4C Task 3) as plain loaders and one POST. Both flags gate everything;
// members only (a non-member gets not_found, a 404); a child context reads the set and scores of its own circles only and
// never reaches interests or a write; ids come from the session, never the form; no email anywhere.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { newTestDb } from '../helpers/test-db';
import { childIn, circleOf, fixtures, item, join, type Fixtures } from '../helpers/circle-play';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { switchToProfile } from '@/lib/accounts/context';
import { recordAnswer } from '@/lib/accounts/responses';
import { getCircleInterests } from '@/lib/circles/interests';
import { loadInterestsPage, loadScoresPage, loadSetPage, loadSetStatus, saveCircleInterestsRequest } from '@/lib/circles/play-web';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let f: Fixtures;
const NOW = new Date('2026-11-05T12:00:00Z');
const HEAD = { host: 'staging.sparkkindly.com', origin: 'https://staging.sparkkindly.com', 'content-type': 'application/x-www-form-urlencoded' };
let n = 0;

const post = (body: [string, string][], cookie?: string, origin?: string | null) => {
  const headers: Record<string, string> = { ...HEAD };
  if (origin === null) delete headers.origin;
  else if (origin) headers.origin = origin;
  if (cookie) headers.cookie = `__Host-sk_account=${cookie}`;
  return new Request('http://localhost/x', { method: 'POST', headers, body: new URLSearchParams(body).toString() });
};
const deps = () => ({ db, now: NOW, limit: () => true });
const where = (r: Response) => [r.status, r.headers.get('location')];

async function account() {
  const email = `pweb${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth: '1990-05-05' }, NOW);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, NOW))!, NOW))!;
  return { id: r.accountId, email, session };
}

// Mum owns a family circle with Bea and Mum's child Mia; Mum also has a friends circle Mia is not in.
async function family() {
  const mum = await account();
  const bea = await account();
  const stranger = await account();
  const c = await circleOf(db, mum.id);
  await join(db, c.slug, bea.id, 'Bea');
  const mia = await childIn(db, mum.id, c.slug, 'Mia');
  const other = await circleOf(db, mum.id, { kind: 'friends', name: 'Mum F' });
  return { mum, bea, stranger, mia, c, other };
}

beforeAll(async () => {
  db = await newTestDb();
  f = await fixtures(db);
  for (let i = 0; i < 6; i++) await item(db, { world: f.worlds.a });
  await item(db, { world: f.worlds.a, audience: 'adults' });
});
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('CIRCLES_ENABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const loaders = (token: string, slug: string) => ({
  set: () => loadSetPage(db, token, slug, NOW),
  scores: () => loadScoresPage(db, token, slug, NOW),
  interests: () => loadInterestsPage(db, token, slug),
});

describe('flags and membership', () => {
  it('with either flag off everything is not_found / 404', async () => {
    const { mum, c } = await family();
    for (const [a, b] of [['true', ''], ['', 'true']]) {
      vi.stubEnv('ACCOUNTS_ENABLED', a);
      vi.stubEnv('CIRCLES_ENABLED', b);
      for (const load of Object.values(loaders(mum.session, c.slug))) expect(await load()).toEqual({ status: 'not_found' });
      expect((await saveCircleInterestsRequest(post([], mum.session), deps(), c.slug)).status).toBe(404);
    }
  });

  it('a non-member, a forged slug and no session get not_found or sign_in', async () => {
    const { stranger, mum, c } = await family();
    for (const load of Object.values(loaders(stranger.session, c.slug))) expect(await load()).toEqual({ status: 'not_found' });
    for (const load of Object.values(loaders(mum.session, 'zzzzzzzzzz'))) expect(await load()).toEqual({ status: 'not_found' });
    for (const load of Object.values(loaders('', c.slug))) expect(await load()).toEqual({ status: 'sign_in' });
    expect(await loadSetStatus(db, stranger.id, c.slug, NOW)).toBeNull();
  });
});

describe('the set and scores pages', () => {
  it('members see the set with their own answered state and the scores; no email, no chosen answer', async () => {
    const { mum, bea, c } = await family();
    // The circle page's status line only reads: before anyone opens the set, there is none and none is made.
    expect(await loadSetStatus(db, mum.id, c.slug, NOW)).toEqual({ items: 0, answered: 0 });
    expect((await db.query('SELECT 1 FROM circle_daily_sets WHERE circle_id = $1', [c.id])).rows).toEqual([]);
    const page = await loadSetPage(db, mum.session, c.slug, NOW);
    if (page.status !== 'ok') throw new Error(page.status);
    expect(page.items).toHaveLength(5);
    await recordAnswer(db, { accountId: mum.id, profileId: null }, page.items[0].itemId, true, NOW, 'b');
    const again = await loadSetPage(db, mum.session, c.slug, NOW);
    expect(again.status === 'ok' && again.items.map((i) => i.state)).toEqual(['answered', 'not_yet', 'not_yet', 'not_yet', 'not_yet']);
    const theirs = await loadSetPage(db, bea.session, c.slug, NOW);
    expect(theirs.status === 'ok' && theirs.items.every((i) => i.state === 'not_yet')).toBe(true);
    expect(await loadSetStatus(db, mum.id, c.slug, NOW)).toEqual({ items: 5, answered: 1 });
    const scores = await loadScoresPage(db, bea.session, c.slug, NOW);
    expect(scores.status === 'ok' && scores.tallies.day[0]).toMatchObject({ name: 'Mum', points: 10, rank: 1 });
    const text = JSON.stringify([again, theirs, scores]);
    for (const e of [mum.email, bea.email, '@', '"choice"', '"b"']) expect(text).not.toContain(e);
  });

  it('a child context reads the set and scores of its own circle (no adults item), and nothing of another circle', async () => {
    const { mum, mia, c, other } = await family();
    expect(await switchToProfile(db, mum.session, mia, NOW)).toBe(true);
    const set = await loadSetPage(db, mum.session, c.slug, NOW);
    expect(set.status).toBe('ok');
    const adultsIds = (await db.query<{ id: string }>("SELECT id FROM items WHERE audience = 'adults'")).rows.map((r) => r.id);
    expect(set.status === 'ok' && set.items.some((i) => adultsIds.includes(i.itemId))).toBe(false);
    const scores = await loadScoresPage(db, mum.session, c.slug, NOW);
    expect(scores.status === 'ok' && scores.tallies.day.find((r) => r.you)?.name).toBe('Mia');
    expect(await loadSetPage(db, mum.session, other.slug, NOW)).toEqual({ status: 'not_found' });
    expect(await loadScoresPage(db, mum.session, other.slug, NOW)).toEqual({ status: 'not_found' });
    expect(await loadInterestsPage(db, mum.session, c.slug)).toEqual({ status: 'child' });
    expect((await saveCircleInterestsRequest(post([['world', String(f.worlds.a)]], mum.session), deps(), c.slug)).status).toBe(403);
    expect(await getCircleInterests(db, mum.id, c.slug)).toEqual({ worldIds: [], topicIds: [] });
  });
});

describe('interests', () => {
  it('the owner saves; forged ids are invalid; a member is refused; Origin is checked; outcome codes only', async () => {
    const { mum, bea, c } = await family();
    const back = (code: string) => [303, `/circles/${c.slug}/interests/?r=${code}#result`];
    const body: [string, string][] = [['world', String(f.worlds.a)], ['topic', String(f.topics.x)], ['account_id', bea.id]];
    const ok = await saveCircleInterestsRequest(post(body, mum.session), deps(), c.slug);
    expect(where(ok)).toEqual(back('saved'));
    expect(ok.headers.get('cache-control')).toContain('no-store');
    expect(await getCircleInterests(db, mum.id, c.slug)).toEqual({ worldIds: [f.worlds.a], topicIds: [f.topics.x] });
    for (const bad of [[['world', '999999']], [['world', 'abc']], [['topic', '-1']]] as [string, string][][]) {
      expect(where(await saveCircleInterestsRequest(post(bad, mum.session), deps(), c.slug))).toEqual(back('invalid'));
    }
    expect(where(await saveCircleInterestsRequest(post([['world', String(f.worlds.b)]], bea.session), deps(), c.slug))).toEqual(back('not-owner'));
    expect((await saveCircleInterestsRequest(post([], mum.session, 'https://evil.example'), deps(), c.slug)).status).toBe(403);
    expect(await getCircleInterests(db, mum.id, c.slug)).toEqual({ worldIds: [f.worlds.a], topicIds: [f.topics.x] });
    const page = await loadInterestsPage(db, bea.session, c.slug);
    expect(page.status === 'ok' && [page.isOwner, page.interests]).toEqual([false, { worldIds: [f.worlds.a], topicIds: [f.topics.x] }]);
    expect(JSON.stringify(page)).not.toContain('@');
  });
});

describe('scores stay inside circles', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === 'node_modules' || name.startsWith('.') ? [] : files(full);
      return /\.(ts|tsx|mjs|js)$/.test(name) ? [full] : [];
    });

  it('nothing outside app/circles/** and lib/circles/** imports lib/circles/scores', () => {
    const offenders = ['app', 'components', 'lib', 'worker', 'scripts', 'agents']
      .flatMap((d) => {
        try {
          return files(path.join(ROOT, d));
        } catch {
          return [];
        }
      })
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .filter((rel) => !rel.startsWith('app/circles/') && !rel.startsWith('lib/circles/'))
      .filter((rel) => /circles\/scores['"]/.test(readFileSync(path.join(ROOT, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
