// @vitest-environment node
// Social daily selection on PGlite (plan 5A Task 1): the migration's seed (caps 2/3/1/1, all off), the promoter role in
// the agents CHECK, candidates (eligible, published in the last 3 days, no distribution yet for that platform), the cap
// and the fixed skip reasons, idempotent reruns, disabled platform or flag off selects nothing, and the owner's
// hand-pick (bypasses rotation, never eligibility or the cap).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { distribution, socialItem } from '../helpers/social';
import { seedReference } from '@/db/seed';
import { handPick, selectForDay } from '@/lib/social/select';
import { createAgent } from '@/lib/agents/admin';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const DAY = '2026-11-05';
const NOW = new Date('2026-11-05T06:00:00Z');

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  vi.stubEnv('SOCIAL_ENABLED', 'true');
  await db.query('DELETE FROM distributions');
  await db.query("DELETE FROM job_runs WHERE job = 'social-select'");
  await db.query('DELETE FROM items');
  await db.query("UPDATE social_platforms SET enabled = true, daily_cap = CASE platform WHEN 'instagram' THEN 2 WHEN 'facebook' THEN 3 ELSE 1 END");
});

const rows = async (platform: string) =>
  (
    await db.query<{ item_id: string; status: string; skip_reason: string | null; day: string }>(
      "SELECT item_id, status, skip_reason, to_char(day, 'YYYY-MM-DD') AS day FROM distributions WHERE platform = $1 ORDER BY id",
      [platform],
    )
  ).rows;

describe('migration', () => {
  it('seeds the four platforms, all off, with caps 2/3/1/1', async () => {
    const fresh = await newTestDb();
    try {
      const r = await fresh.query<{ platform: string; enabled: boolean; daily_cap: number }>(
        'SELECT platform, enabled, daily_cap FROM social_platforms ORDER BY platform',
      );
      expect(r.rows).toEqual([
        { platform: 'facebook', enabled: false, daily_cap: 3 },
        { platform: 'instagram', enabled: false, daily_cap: 2 },
        { platform: 'tiktok', enabled: false, daily_cap: 1 },
        { platform: 'youtube', enabled: false, daily_cap: 1 },
      ]);
      await expect(fresh.query("UPDATE social_platforms SET daily_cap = 11 WHERE platform = 'facebook'")).rejects.toThrow();
      await expect(fresh.query("INSERT INTO social_platforms (platform, daily_cap) VALUES ('twitter', 1)")).rejects.toThrow();
    } finally {
      await fresh.close();
    }
  });

  it('allows a promoter agent (never tied to a world) and keeps one row per item and platform', async () => {
    const { id } = await createAgent(db, 'promoter', null, 'promoter');
    expect(id).toBeGreaterThan(0);
    await expect(createAgent(db, 'promoter-play', 'play', 'promoter')).rejects.toThrow();
    const item = await socialItem(db);
    await distribution(db, item, 'instagram');
    await expect(distribution(db, item, 'instagram')).rejects.toThrow();
    await expect(distribution(db, item, 'twitter')).rejects.toThrow();
  });
});

describe('selectForDay', () => {
  it('picks up to the cap and records every other candidate as skipped with a fixed reason', async () => {
    const a = await socialItem(db, { world: 'play', kind: 'quiz' });
    const b = await socialItem(db, { world: 'grow', kind: 'game' });
    const c = await socialItem(db, { world: 'discover', kind: 'article' });
    const d = await socialItem(db, { world: 'play', kind: 'article' });
    expect(await selectForDay(db, 'instagram', DAY, NOW)).toEqual({ selected: 2, skipped: 2 });
    const r = await rows('instagram');
    const by = Object.fromEntries(r.map((x) => [x.item_id, x]));
    // No world has posted: discover, grow, play by slug; discover's only item is an article, grow and discover go first.
    expect(by[c].status).toBe('selected');
    expect(by[b].status).toBe('selected');
    expect(by[a]).toMatchObject({ status: 'skipped', skip_reason: 'world_rotation' });
    expect(by[d]).toMatchObject({ status: 'skipped', skip_reason: 'not_playable' });
    expect(r.every((x) => x.day === DAY)).toBe(true);
  });

  it('rotates: the world with the oldest last post on that platform goes first', async () => {
    const old = await socialItem(db, { world: 'grow', publishedAt: '2026-10-20T00:00:00Z' });
    const older = await socialItem(db, { world: 'play', publishedAt: '2026-10-20T00:00:00Z' });
    await distribution(db, old, 'facebook', { status: 'posted', day: '2026-11-04', postedAt: '2026-11-04T10:00:00Z' });
    await distribution(db, older, 'facebook', { status: 'posted', day: '2026-11-01', postedAt: '2026-11-01T10:00:00Z' });
    const g = await socialItem(db, { world: 'grow', kind: 'quiz' });
    const p = await socialItem(db, { world: 'play', kind: 'quiz' });
    await db.query("UPDATE social_platforms SET daily_cap = 1 WHERE platform = 'facebook'");
    await selectForDay(db, 'facebook', DAY, NOW);
    const by = Object.fromEntries((await rows('facebook')).map((x) => [x.item_id, x]));
    expect(by[p].status).toBe('selected');
    expect(by[g]).toMatchObject({ status: 'skipped', skip_reason: 'world_rotation' });
  });

  it('prefers the topic with more answers in the last 14 days', async () => {
    const acct = await db.query<{ id: string }>(
      "INSERT INTO accounts (email, date_of_birth) VALUES ('soc@example.test', '1990-01-01') ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id",
    );
    const quiet = await socialItem(db, { world: 'play', kind: 'quiz', topic: 'science' });
    const busy = await socialItem(db, { world: 'play', kind: 'quiz', topic: 'nature' });
    {
      const answered = await socialItem(db, { world: 'discover', kind: 'quiz', topic: 'nature', publishedAt: '2026-10-01T00:00:00Z' });
      await db.query("INSERT INTO item_responses (account_id, item_id, correct, answered_at) VALUES ($1, $2, true, '2026-11-03T00:00:00Z')", [
        acct.rows[0].id,
        answered,
      ]);
    }
    await db.query("UPDATE social_platforms SET daily_cap = 1 WHERE platform = 'tiktok'");
    await selectForDay(db, 'tiktok', DAY, NOW);
    const by = Object.fromEntries((await rows('tiktok')).map((x) => [x.item_id, x]));
    expect(by[busy].status).toBe('selected');
    expect(by[quiet]).toMatchObject({ status: 'skipped', skip_reason: 'lower_topic_popularity' });
  });

  it('never considers Kids (world, audience or tier), unpublished, unrendered or older-than-3-days items', async () => {
    await socialItem(db, { world: 'kids', kind: 'quiz' });
    await socialItem(db, { world: 'play', audience: 'kids', kind: 'quiz' });
    await socialItem(db, { world: 'play', riskTier: 'kids', kind: 'quiz' });
    await socialItem(db, { world: 'play', status: 'draft' });
    await socialItem(db, { world: 'play', status: 'archived' });
    await socialItem(db, { world: 'play', status: 'scheduled', publishedAt: '2026-11-06T00:00:00Z' });
    await socialItem(db, { world: 'play', kind: 'video_script' });
    await socialItem(db, { world: 'play', publishedAt: '2026-11-01T05:00:00Z' });
    await socialItem(db, { world: 'play', publishedAt: '2026-11-05T07:00:00Z' }); // in the future
    expect(await selectForDay(db, 'facebook', DAY, NOW)).toEqual({ selected: 0, skipped: 0 });
    expect(await rows('facebook')).toEqual([]);
  });

  it('skips an item that already has a distribution for that platform, but not for another', async () => {
    const a = await socialItem(db);
    await distribution(db, a, 'instagram', { status: 'posted', postedAt: '2026-11-04T10:00:00Z' });
    expect(await selectForDay(db, 'instagram', DAY, NOW)).toEqual({ selected: 0, skipped: 0 });
    expect(await selectForDay(db, 'facebook', DAY, NOW)).toEqual({ selected: 1, skipped: 0 });
  });

  it('is idempotent per platform and day: a rerun (even with new items) changes nothing', async () => {
    await socialItem(db);
    await selectForDay(db, 'instagram', DAY, NOW);
    await socialItem(db, { world: 'grow' });
    expect(await selectForDay(db, 'instagram', DAY, NOW)).toEqual({ selected: 0, skipped: 0 });
    expect(await rows('instagram')).toHaveLength(1);
  });

  it('counts the day\'s hand-picks against the cap', async () => {
    const picked = await socialItem(db, { publishedAt: '2026-10-01T00:00:00Z' });
    expect((await handPick(db, picked, 'instagram', NOW)).ok).toBe(true);
    await socialItem(db, { world: 'grow' });
    await socialItem(db, { world: 'discover' });
    expect(await selectForDay(db, 'instagram', DAY, NOW)).toEqual({ selected: 1, skipped: 1 });
  });

  it('a disabled platform or SOCIAL_ENABLED off selects nothing', async () => {
    await socialItem(db);
    await db.query("UPDATE social_platforms SET enabled = false WHERE platform = 'instagram'");
    expect(await selectForDay(db, 'instagram', DAY, NOW)).toEqual({ selected: 0, skipped: 0 });
    vi.stubEnv('SOCIAL_ENABLED', '');
    expect(await selectForDay(db, 'facebook', DAY, NOW)).toEqual({ selected: 0, skipped: 0 });
    expect(await rows('instagram')).toEqual([]);
    expect(await rows('facebook')).toEqual([]);
  });

  it('a cap of 0 records every candidate as cap_reached', async () => {
    await socialItem(db);
    await db.query("UPDATE social_platforms SET daily_cap = 0 WHERE platform = 'youtube'");
    expect(await selectForDay(db, 'youtube', DAY, NOW)).toEqual({ selected: 0, skipped: 1 });
    expect((await rows('youtube'))[0]).toMatchObject({ status: 'skipped', skip_reason: 'cap_reached' });
  });
});

describe('handPick', () => {
  it('selects an eligible item outside the rotation (any publish date), within the cap; never a second row', async () => {
    const a = await socialItem(db, { world: 'play', kind: 'quiz' });
    const b = await socialItem(db, { world: 'play', kind: 'article' });
    await db.query("UPDATE social_platforms SET daily_cap = 2 WHERE platform = 'instagram'");
    await selectForDay(db, 'instagram', DAY, NOW);
    expect((await rows('instagram')).find((x) => x.item_id === b)?.status).toBe('selected');
    const c = await socialItem(db, { world: 'grow', publishedAt: '2026-09-01T00:00:00Z' });
    expect(await handPick(db, c, 'instagram', NOW)).toEqual({ ok: false, reason: 'cap' });
    await db.query("UPDATE social_platforms SET daily_cap = 3 WHERE platform = 'instagram'");
    expect(await handPick(db, c, 'instagram', NOW)).toEqual({ ok: true });
    expect((await rows('instagram')).find((x) => x.item_id === c)?.status).toBe('selected');
    expect(await handPick(db, a, 'instagram', NOW)).toEqual({ ok: false, reason: 'exists' });
  });

  it('turns a skipped row back into selected', async () => {
    await socialItem(db, { world: 'play', kind: 'quiz' });
    const b = await socialItem(db, { world: 'play', kind: 'article' });
    await db.query("UPDATE social_platforms SET daily_cap = 1 WHERE platform = 'facebook'");
    await selectForDay(db, 'facebook', DAY, NOW);
    await db.query("UPDATE social_platforms SET daily_cap = 2 WHERE platform = 'facebook'");
    expect(await handPick(db, b, 'facebook', NOW)).toEqual({ ok: true });
    expect((await rows('facebook')).find((x) => x.item_id === b)).toMatchObject({ status: 'selected', skip_reason: null });
  });

  it('refuses Kids, unpublished and unknown items, an unknown or disabled platform, and with the flag off', async () => {
    const kids = await socialItem(db, { world: 'kids' });
    const kidsAudience = await socialItem(db, { audience: 'kids' });
    const draft = await socialItem(db, { status: 'draft' });
    for (const id of [kids, kidsAudience, draft, '00000000-0000-0000-0000-000000000000', 'not-a-uuid']) {
      expect(await handPick(db, id, 'instagram', NOW)).toEqual({ ok: false, reason: 'ineligible' });
    }
    const fine = await socialItem(db);
    expect(await handPick(db, fine, 'twitter' as never, NOW)).toEqual({ ok: false, reason: 'platform' });
    await db.query("UPDATE social_platforms SET enabled = false WHERE platform = 'instagram'");
    expect(await handPick(db, fine, 'instagram', NOW)).toEqual({ ok: false, reason: 'platform' });
    vi.stubEnv('SOCIAL_ENABLED', '');
    expect(await handPick(db, fine, 'facebook', NOW)).toEqual({ ok: false, reason: 'platform' });
    expect(await rows('instagram')).toEqual([]);
  });
});
