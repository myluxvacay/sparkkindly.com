// @vitest-environment node
// Growth prompts after an answer (plan 4D Task 3): an adult-context member who answered an item in today's set for one
// of their circles is offered "Invite someone to <circle>" and "Share this game"; nobody else is, and no URL carries a
// circle, member or account id.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { adult, childIn, circleOf, fixtures, item, join, type Fixtures } from '../helpers/circle-play';
import type { AccountContext } from '@/lib/accounts/context';
import { getOrCreateDailySet } from '@/lib/circles/daily-set';
import { sharePromptFor } from '@/lib/circles/share-prompt';
import { removeChildFromCircle } from '@/lib/circles/children';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let f: Fixtures;
let kidsWorld: number;
const NOW = new Date('2026-11-05T12:00:00Z');
const BASE = 'https://staging.sparkkindly.com';

beforeAll(async () => {
  db = await newTestDb();
  f = await fixtures(db);
  kidsWorld = (await db.query<{ id: number }>("INSERT INTO worlds (slug, name, approval_mode) VALUES ('kids', 'Kids', 'review') ON CONFLICT (slug) DO UPDATE SET name = 'Kids' RETURNING id")).rows[0].id;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('CIRCLES_ENABLED', 'true');
  await db.query('DELETE FROM circles');
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM items');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// Only the fields sharePromptFor reads: the account id and whether a child profile is active.
const ctx = (accountId: string, profile: string | null = null) =>
  ({ account: { id: accountId, ageGroup: 'adult', consentState: 'none' }, profile: profile ? { id: profile } : null, audiences: [] }) as unknown as AccountContext;
const slugOf = async (id: string) => (await db.query<{ slug: string }>('SELECT slug FROM items WHERE id = $1', [id])).rows[0].slug;

async function memberWithSet(kind = 'friends') {
  const quiz = await item(db, { world: f.worlds.a });
  const owner = await adult(db);
  const c = await circleOf(db, owner, { kind });
  const bea = await adult(db);
  await join(db, c.slug, bea, 'Bea');
  expect((await getOrCreateDailySet(db, c.id, NOW)).map((s) => s.itemId)).toEqual([quiz]);
  return { quiz, owner, bea, c };
}

describe('sharePromptFor', () => {
  it('offers the circle invite link and the public item URL to an adult-context member', async () => {
    const { quiz, owner, c } = await memberWithSet();
    const p = await sharePromptFor(db, ctx(owner), quiz, NOW, BASE);
    expect(p).toEqual({
      circles: [{ name: 'Home', inviteHref: `/circles/${c.slug}/#invites` }],
      shareUrl: `${BASE}/wa/${await slugOf(quiz)}/`,
    });
  });

  it('no URL carries a query string or a circle, member or account id', async () => {
    const { quiz, owner, bea, c } = await memberWithSet();
    const p = (await sharePromptFor(db, ctx(owner), quiz, NOW, BASE))!;
    const urls = [p.shareUrl, ...p.circles.map((x) => x.inviteHref)];
    for (const u of urls) {
      expect(u).not.toContain('?');
      for (const id of [owner, bea, c.id]) expect(u).not.toContain(id);
    }
    expect(p.shareUrl).not.toContain(c.slug);
  });

  it('is null for anonymous, a child context, a non-member, an item outside today’s set and a Kids world item', async () => {
    const { quiz, owner, c } = await memberWithSet('family');
    const kid = await childIn(db, owner, c.slug, 'Mia');
    const stranger = await adult(db);
    const outside = await item(db, { world: f.worlds.b });
    expect(await sharePromptFor(db, null, quiz, NOW, BASE)).toBeNull();
    expect(await sharePromptFor(db, ctx(owner, kid), quiz, NOW, BASE)).toBeNull();
    expect(await sharePromptFor(db, ctx(stranger), quiz, NOW, BASE)).toBeNull();
    expect(await sharePromptFor(db, ctx(owner), outside, NOW, BASE)).toBeNull();
    expect(await sharePromptFor(db, ctx(owner), quiz, new Date('2026-11-07T12:00:00Z'), BASE)).toBeNull();
    expect(await sharePromptFor(db, ctx(owner), 'not-a-uuid', NOW, BASE)).toBeNull();
    const kidsItem = await item(db, { world: kidsWorld, audience: 'kids' });
    await db.query("INSERT INTO circle_daily_sets (circle_id, day, position, item_id) VALUES ($1, '2026-11-05', 2, $2)", [c.id, kidsItem]);
    expect(await sharePromptFor(db, ctx(owner), kidsItem, NOW, BASE)).toBeNull();
  });

  it('is null for a left member, a hidden circle and with circles off', async () => {
    const { quiz, owner, bea, c } = await memberWithSet();
    await db.query('UPDATE circle_members SET left_at = now() WHERE account_id = $1', [bea]);
    expect(await sharePromptFor(db, ctx(bea), quiz, NOW, BASE)).toBeNull();
    await db.query('UPDATE circles SET hidden_at = now() WHERE id = $1', [c.id]);
    expect(await sharePromptFor(db, ctx(owner), quiz, NOW, BASE)).toBeNull();
    await db.query('UPDATE circles SET hidden_at = NULL WHERE id = $1', [c.id]);
    vi.stubEnv('CIRCLES_ENABLED', '');
    expect(await sharePromptFor(db, ctx(owner), quiz, NOW, BASE)).toBeNull();
  });

  it('a member who may not invite (a circle holding a child, not the owner) gets only the share link', async () => {
    const { quiz, owner, bea, c } = await memberWithSet('family');
    await childIn(db, owner, c.slug, 'Mia');
    expect(await sharePromptFor(db, ctx(bea), quiz, NOW, BASE)).toEqual({ circles: [], shareUrl: `${BASE}/wa/${await slugOf(quiz)}/` });
    expect((await sharePromptFor(db, ctx(owner), quiz, NOW, BASE))!.circles).toHaveLength(1);
  });

  it('an adults item hidden from a circle that holds a child is not "in its set"', async () => {
    const adultsItem = await item(db, { world: f.worlds.a, audience: 'adults' });
    const owner = await adult(db);
    const c = await circleOf(db, owner, { kind: 'family' });
    await db.query("INSERT INTO circle_daily_sets (circle_id, day, position, item_id) VALUES ($1, '2026-11-05', 1, $2)", [c.id, adultsItem]);
    expect(await sharePromptFor(db, ctx(owner), adultsItem, NOW, BASE)).not.toBeNull();
    await childIn(db, owner, c.slug, 'Mia');
    expect(await sharePromptFor(db, ctx(owner), adultsItem, NOW, BASE)).toBeNull();
  });

  it('an adults item stays out after a child joins and is removed the same day (child days, final review 1)', async () => {
    const adultsItem = await item(db, { world: f.worlds.a, audience: 'adults' });
    const owner = await adult(db);
    const c = await circleOf(db, owner, { kind: 'family' });
    expect((await getOrCreateDailySet(db, c.id, NOW)).map((s) => s.itemId)).toEqual([adultsItem]);
    const kid = await childIn(db, owner, c.slug, 'Mia');
    await db.query('UPDATE circle_members SET joined_at = $2 WHERE profile_id = $1', [kid, NOW.toISOString()]);
    expect(await removeChildFromCircle(db, owner, c.slug, kid, new Date(NOW.getTime() + 3_600_000))).toBe(true);
    expect(await sharePromptFor(db, ctx(owner), adultsItem, new Date(NOW.getTime() + 7_200_000), BASE)).toBeNull();
  });
});
