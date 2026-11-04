// @vitest-environment node
// The /me dashboard and the interests save POST (plan 3D, Task 4). Everything shown comes through the scoped public
// reads with the context's audiences, so a child context never sees an `adults` item; "today" is the account's own
// local calendar day; the owner of a save is the session's context, never a form field.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { createChildProfile } from '@/lib/accounts/children';
import { getContext, switchToProfile, type AccountContext } from '@/lib/accounts/context';
import { getInterests, interestChoices, setInterests } from '@/lib/accounts/interests';
import { recordAnswer } from '@/lib/accounts/responses';
import { dashboardFor, localDayStart } from '@/lib/accounts/dashboard';
import { saveInterestsRequest } from '@/lib/accounts/interests-web';
import { createAccountActionLimits } from '@/lib/accounts/limits';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-04T12:00:00Z');
const HEAD = {
  host: 'staging.sparkkindly.com',
  origin: 'https://staging.sparkkindly.com',
  'content-type': 'application/x-www-form-urlencoded',
};
let n = 0;

const worldId = async (slug: string) => (await db.query<{ id: number }>('SELECT id FROM worlds WHERE slug = $1', [slug])).rows[0].id;
// A topic of its own per test, so items from other tests never match.
const topic = async () =>
  (await db.query<{ id: number }>('INSERT INTO topics (slug, name) VALUES ($1, $1) RETURNING id', [`dash-${n++}`])).rows[0].id;

async function item(o: { world?: string; audience?: string; at: string; topicId?: number; slug?: string }): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     VALUES ($1,'quiz',$2,'T','S','{}'::jsonb,$3,'published',$4,'test','computable','test') RETURNING id`,
    [await worldId(o.world ?? 'play'), o.slug ?? `dash-item-${n++}`, o.audience ?? 'all', o.at],
  );
  if (o.topicId) await db.query('INSERT INTO item_topics (item_id, topic_id) VALUES ($1, $2)', [r.rows[0].id, o.topicId]);
  return r.rows[0].id;
}

async function account(dateOfBirth = '1990-05-05', timeZone?: string) {
  const email = `dash${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth, parentEmail: 'parent@example.test' }, NOW);
  if (r.status !== 'created') throw new Error('sign-up failed');
  if (timeZone) await db.query('UPDATE accounts SET time_zone = $2 WHERE id = $1', [r.accountId, timeZone]);
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, NOW))!, NOW))!;
  return { accountId: r.accountId, session };
}
async function profile(accountId: string, name = 'Mia') {
  const p = await createChildProfile(db, accountId, { displayName: name, ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, NOW);
  if (p.status !== 'created') throw new Error('profile not created');
  return p.profileId;
}
const ctxOf = async (session: string) => (await getContext(db, session, NOW))!;
async function childCtx() {
  const a = await account();
  const profileId = await profile(a.accountId);
  expect(await switchToProfile(db, a.session, profileId, NOW)).toBe(true);
  return { ...a, profileId, ctx: await ctxOf(a.session) };
}
const ids = (items: { id: string }[]) => items.map((i) => i.id).sort();
const owner = (ctx: AccountContext) => ({ accountId: ctx.account.id, profileId: ctx.profile?.id ?? null });

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});

describe('dashboardFor', () => {
  it('a child context never receives an adults item in today, recent, answered or the progress count', async () => {
    const c = await childCtx();
    const t = await topic();
    const grow = await worldId('grow');
    const adultsToday = await item({ world: 'grow', audience: 'adults', at: '2026-11-04T09:00:00Z' });
    const adultsTopic = await item({ audience: 'adults', at: '2026-11-02T09:00:00Z', topicId: t });
    const kidsToday = await item({ world: 'grow', audience: 'kids', at: '2026-11-04T10:00:00Z' });
    const allRecent = await item({ audience: 'all', at: '2026-11-02T10:00:00Z', topicId: t });
    expect(await setInterests(db, owner(c.ctx), { topicIds: [t], worldIds: [grow] })).toBe('ok');
    for (const [id, ok] of [[adultsToday, true], [adultsTopic, true], [kidsToday, true], [allRecent, false]] as const) {
      await recordAnswer(db, owner(c.ctx), id, ok, NOW);
    }
    const d = await dashboardFor(db, c.ctx, NOW);
    expect(d.hasInterests).toBe(true);
    expect(ids(d.today)).toEqual([kidsToday]);
    expect(ids(d.recent)).toEqual([allRecent]);
    expect(ids(d.answered.map((a) => a.item))).toEqual([kidsToday, allRecent].sort());
    expect(d.progress).toEqual({ total: 2, correct: 1 });
    const all = [...d.today, ...d.recent, ...d.answered.map((a) => a.item)];
    expect(all.every((i) => i.audience !== 'adults')).toBe(true);

    // The same interests in the adult context see the adults items (an account sees what an anonymous visitor sees).
    const adult = await ctxOf((await account()).session);
    await setInterests(db, owner(adult), { topicIds: [t], worldIds: [grow] });
    const ad = await dashboardFor(db, adult, NOW);
    expect(ids(ad.today)).toEqual(expect.arrayContaining([adultsToday, kidsToday]));
    expect(ids(ad.recent)).toEqual(expect.arrayContaining([adultsTopic, allRecent]));
  });

  it("America/Los_Angeles: today is the account's local day, not the UTC day", async () => {
    // 06:00Z on 4 November is 22:00 on 3 November in Los Angeles (PST, UTC-8): the local day is 3 Nov 08:00Z to 4 Nov 08:00Z.
    const at = new Date('2026-11-04T06:00:00Z');
    const t = await topic();
    const localToday = await item({ at: '2026-11-03T20:00:00Z', topicId: t }); // UTC says yesterday
    const localYesterday = await item({ at: '2026-11-03T07:00:00Z', topicId: t });
    const tooOld = await item({ at: '2026-10-19T07:00:00Z', topicId: t }); // 15 local days back
    const a = await account('1990-05-05', 'America/Los_Angeles');
    const ctx = await getContext(db, a.session, at);
    await setInterests(db, owner(ctx!), { topicIds: [t], worldIds: [] });
    const d = await dashboardFor(db, ctx!, at);
    expect(ids(d.today)).toEqual([localToday]);
    expect(ids(d.recent)).toEqual([localYesterday]);
    expect(ids([...d.today, ...d.recent])).not.toContain(tooOld);
  });

  it('Pacific/Kiritimati: an item from 09:00Z is yesterday there although it is today in UTC', async () => {
    // 11:00Z on 4 November is 01:00 on 5 November in Kiritimati (UTC+14): the local day starts 4 Nov 10:00Z.
    const at = new Date('2026-11-04T11:00:00Z');
    const t = await topic();
    const localToday = await item({ at: '2026-11-04T10:30:00Z', topicId: t });
    const localYesterday = await item({ at: '2026-11-04T09:00:00Z', topicId: t });
    const a = await account('1990-05-05', 'Pacific/Kiritimati');
    const ctx = (await getContext(db, a.session, at))!;
    await setInterests(db, owner(ctx), { topicIds: [t], worldIds: [] });
    const d = await dashboardFor(db, ctx, at);
    expect(ids(d.today)).toEqual([localToday]);
    expect(ids(d.recent)).toEqual([localYesterday]);
  });

  it('local day starts are DST-safe and an unknown zone falls back to UTC', () => {
    // 8 March 2026: Los Angeles springs forward at 02:00, so the day starts at 08:00Z (PST) and the next at 07:00Z (PDT).
    expect(localDayStart(new Date('2026-03-08T12:00:00Z'), 'America/Los_Angeles', 0).toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(localDayStart(new Date('2026-03-08T12:00:00Z'), 'America/Los_Angeles', 1).toISOString()).toBe('2026-03-09T07:00:00.000Z');
    expect(localDayStart(NOW, 'Pacific/Kiritimati', -1).toISOString()).toBe('2026-11-03T10:00:00.000Z');
    expect(localDayStart(NOW, 'Not/AZone', 0).toISOString()).toBe('2026-11-04T00:00:00.000Z');
    // Sydney leaves DST at 03:00 on 5 April 2026: the day started at midnight AEDT (UTC+11). The first offset guess
    // (taken at 00:00Z, already AEST) is an hour off; the second pass corrects it.
    expect(localDayStart(new Date('2026-04-05T12:00:00Z'), 'Australia/Sydney', 0).toISOString()).toBe('2026-04-04T13:00:00.000Z');
    // ...and enters DST at 02:00 on 4 October 2026: that day started at midnight AEST (UTC+10).
    expect(localDayStart(new Date('2026-10-04T12:00:00Z'), 'Australia/Sydney', 0).toISOString()).toBe('2026-10-03T14:00:00.000Z');
    // Santiago skips from 00:00 to 01:00 on 6 September 2026: local midnight does not exist, the day starts at 01:00 -03.
    expect(localDayStart(new Date('2026-09-06T12:00:00Z'), 'America/Santiago', 0).toISOString()).toBe('2026-09-06T04:00:00.000Z');
  });

  it('recent holds at most 20 items', async () => {
    const t = await topic();
    for (let i = 0; i < 22; i++) await item({ at: `2026-11-0${1 + (i % 3)}T0${i % 10}:00:00Z`, topicId: t });
    const ctx = await ctxOf((await account()).session);
    await setInterests(db, owner(ctx), { topicIds: [t], worldIds: [] });
    expect((await dashboardFor(db, ctx, NOW)).recent).toHaveLength(20);
  });

  it('with no interests: hasInterests is false and no items are suggested', async () => {
    await item({ at: '2026-11-04T09:00:00Z' });
    const d = await dashboardFor(db, await ctxOf((await account()).session), NOW);
    expect(d).toMatchObject({ hasInterests: false, today: [], recent: [], answered: [], progress: { total: 0, correct: 0 } });
  });

  it("another profile's answers on the same account are not shown", async () => {
    const c = await childCtx();
    const sibling = await profile(c.accountId, 'Leo');
    const mine = await item({ at: '2026-11-01T09:00:00Z' });
    const theirs = await item({ at: '2026-11-01T09:00:00Z' });
    const holders = await item({ at: '2026-11-01T09:00:00Z' });
    await recordAnswer(db, owner(c.ctx), mine, true, NOW);
    await recordAnswer(db, { accountId: c.accountId, profileId: sibling }, theirs, true, NOW);
    await recordAnswer(db, { accountId: c.accountId, profileId: null }, holders, true, NOW);
    const d = await dashboardFor(db, c.ctx, NOW);
    expect(ids(d.answered.map((a) => a.item))).toEqual([mine]);
    expect(d.progress).toEqual({ total: 1, correct: 1 });
    expect(d.answered[0]).toMatchObject({ correct: true, answeredAt: NOW });
  });
});

describe('dashboardFor: answered history uses the public visibility rule', () => {
  const answeredIds = (d: { answered: { item: { id: string } }[] }) => d.answered.map((a) => a.item.id);

  it.each([
    ['turned into a video_script', "kind = 'video_script'"],
    ['moved to a future published_at', "published_at = '2026-12-01T00:00:00Z'"],
    ['archived', "status = 'archived'"],
    ['in another locale', "locale = 'fr'"],
  ])('an answered item later %s is absent from both the list and the count', async (_label, change) => {
    const ctx = await ctxOf((await account()).session);
    const kept = await item({ at: '2026-11-01T09:00:00Z' });
    const hidden = await item({ at: '2026-11-01T09:00:00Z' });
    await recordAnswer(db, owner(ctx), kept, true, NOW);
    await recordAnswer(db, owner(ctx), hidden, true, new Date(NOW.getTime() + 1000));
    await db.query(`UPDATE items SET ${change} WHERE id = $1`, [hidden]);
    const d = await dashboardFor(db, ctx, new Date(NOW.getTime() + 5000));
    expect(answeredIds(d)).toEqual([kept]);
    expect(d.progress).toEqual({ total: 1, correct: 1 });
  });

  it('an answered item whose published_at is in the future is not listed', async () => {
    const ctx = await ctxOf((await account()).session);
    const future = await item({ at: '2026-11-04T18:00:00Z' });
    await recordAnswer(db, owner(ctx), future, false, NOW);
    expect((await dashboardFor(db, ctx, NOW)).answered).toEqual([]);
  });

  it('hidden newest answers do not use up the 20-item cap: the 20 newest visible answers are shown', async () => {
    const ctx = await ctxOf((await account()).session);
    const all: string[] = [];
    for (let i = 0; i < 23; i++) {
      const id = await item({ at: '2026-11-01T09:00:00Z' });
      await recordAnswer(db, owner(ctx), id, true, new Date(NOW.getTime() - (23 - i) * 60_000));
      all.push(id);
    }
    // The three newest answers become hidden in ways only the public visibility rule knows about.
    await db.query("UPDATE items SET kind = 'video_script' WHERE id = $1", [all[20]]);
    await db.query("UPDATE items SET locale = 'fr' WHERE id = $1", [all[21]]);
    await db.query("UPDATE items SET published_at = '2026-12-01T00:00:00Z' WHERE id = $1", [all[22]]);
    const d = await dashboardFor(db, ctx, NOW);
    expect(answeredIds(d)).toEqual(all.slice(0, 20).reverse());
    expect(d.progress.total).toBe(20);
  });
});

describe('interestChoices', () => {
  it('offers enabled worlds and topics grouped under their parent, with lone top-level topics under Other', async () => {
    await db.query("INSERT INTO worlds (slug, name, enabled) VALUES ('dash-hidden', 'Dash hidden', false)");
    const c = await interestChoices(db);
    expect(c.worlds.map((w) => w.name)).toContain('Grow');
    expect(c.worlds.map((w) => w.name)).not.toContain('Dash hidden');
    const science = c.topicGroups.find((g) => g.name === 'Science')!;
    expect(science.topics[0].name).toBe('Science in general');
    expect(science.topics.map((t) => t.name)).toEqual(expect.arrayContaining(['Physics', 'Space']));
    expect(c.topicGroups.at(-1)!.name).toBe('Other');
    expect(c.topicGroups.at(-1)!.topics.map((t) => t.name)).toContain('Curiosity');
  });
});

const post = (body: string, opts: { cookie?: string; origin?: string | null } = {}) => {
  const headers: Record<string, string> = { ...HEAD };
  if (opts.origin === null) delete headers.origin;
  else if (opts.origin) headers.origin = opts.origin;
  if (opts.cookie) headers.cookie = `__Host-sk_account=${opts.cookie}`;
  return new Request('http://localhost/me/interests/save/', { method: 'POST', headers, body });
};
const where = (r: Response) => [r.status, r.headers.get('location')];
const deps = () => ({ db, now: NOW });

describe('saveInterestsRequest', () => {
  it("saves for the session's owner only; a foreign account or profile id in the form is ignored", async () => {
    const a = await account();
    const b = await account();
    const bProfile = await profile(b.accountId);
    const t = await topic();
    const grow = await worldId('grow');
    const body = `topic=${t}&world=${grow}&account_id=${b.accountId}&profile_id=${bProfile}`;
    expect(where(await saveInterestsRequest(post(body, { cookie: a.session }), deps()))).toEqual([
      303,
      '/me/interests/?r=saved#result',
    ]);
    expect(await getInterests(db, { accountId: a.accountId, profileId: null })).toEqual({ topicIds: [t], worldIds: [grow] });
    expect(await getInterests(db, { accountId: b.accountId, profileId: bProfile })).toEqual({ topicIds: [], worldIds: [] });
    expect(await getInterests(db, { accountId: b.accountId, profileId: null })).toEqual({ topicIds: [], worldIds: [] });
  });

  it('a child context saves its own interests, not the account holder', async () => {
    const c = await childCtx();
    const t = await topic();
    expect(where(await saveInterestsRequest(post(`topic=${t}`, { cookie: c.session }), deps()))[1]).toBe('/me/interests/?r=saved#result');
    expect(await getInterests(db, { accountId: c.accountId, profileId: c.profileId })).toEqual({ topicIds: [t], worldIds: [] });
    expect(await getInterests(db, { accountId: c.accountId, profileId: null })).toEqual({ topicIds: [], worldIds: [] });
  });

  it('a consent-pending 13-15 account may save interests', async () => {
    const teenDob = `${NOW.getUTCFullYear() - 14}-01-01`;
    const a = await account(teenDob);
    expect((await ctxOf(a.session)).account.consent).toBe('pending');
    const t = await topic();
    expect(where(await saveInterestsRequest(post(`topic=${t}`, { cookie: a.session }), deps()))[1]).toBe('/me/interests/?r=saved#result');
    expect((await getInterests(db, { accountId: a.accountId, profileId: null })).topicIds).toEqual([t]);
  });

  it('unchecking everything clears the set; bad ids are refused with nothing written', async () => {
    const a = await account();
    const t = await topic();
    await saveInterestsRequest(post(`topic=${t}`, { cookie: a.session }), deps());
    expect(where(await saveInterestsRequest(post('topic=abc', { cookie: a.session }), deps()))[1]).toBe('/me/interests/?r=invalid#result');
    expect(where(await saveInterestsRequest(post('topic=99999999', { cookie: a.session }), deps()))[1]).toBe('/me/interests/?r=invalid#result');
    expect((await getInterests(db, { accountId: a.accountId, profileId: null })).topicIds).toEqual([t]);
    expect(where(await saveInterestsRequest(post('', { cookie: a.session }), deps()))[1]).toBe('/me/interests/?r=saved#result');
    expect(await getInterests(db, { accountId: a.accountId, profileId: null })).toEqual({ topicIds: [], worldIds: [] });
  });

  it('the 31st save in an hour for one account gets 429 and writes nothing', async () => {
    const a = await account();
    const t = await topic();
    const limit = createAccountActionLimits(() => 0);
    for (let i = 0; i < 30; i++) await saveInterestsRequest(post('', { cookie: a.session }), { ...deps(), limit });
    const r = await saveInterestsRequest(post(`topic=${t}`, { cookie: a.session }), { ...deps(), limit });
    expect(r.status).toBe(429);
    expect(await r.text()).toBe('Too many attempts. Please try again later.');
    expect((await getInterests(db, { accountId: a.accountId, profileId: null })).topicIds).toEqual([]);
  });

  it('is same-origin only: another or a missing Origin is refused and nothing is written', async () => {
    const a = await account();
    const t = await topic();
    for (const origin of ['https://evil.example', null]) {
      expect((await saveInterestsRequest(post(`topic=${t}`, { cookie: a.session, origin }), deps())).status).toBe(403);
    }
    expect((await getInterests(db, { accountId: a.accountId, profileId: null })).topicIds).toEqual([]);
  });

  it('no session goes to sign-in and writes nothing', async () => {
    expect(where(await saveInterestsRequest(post('topic=1'), deps()))).toEqual([303, '/account/sign-in/']);
    expect(where(await saveInterestsRequest(post('topic=1', { cookie: 'garbage' }), deps()))).toEqual([303, '/account/sign-in/']);
  });

  it('the route is a 404 with ACCOUNTS_ENABLED off', async () => {
    vi.stubEnv('ACCOUNTS_ENABLED', '');
    try {
      const { POST } = await import('@/app/me/interests/save/route');
      expect((await POST(post('topic=1'))).status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
