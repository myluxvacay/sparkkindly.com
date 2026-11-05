// @vitest-environment node
// The social poster and its jobs (plan 5A Task 3) on PGlite with injected adapters and fetch: posts exactly the stored,
// validated text; one row at a time claimed with a conditional UPDATE (two concurrent ticks post once); missing
// credentials leave rows scheduled and report it; transient failures retry 3 times 5 minutes apart then fail; permanent
// failures fail at once with one alert; an ambiguous failure (may have posted) is flagged, never retried; a row stuck in
// `posting` for 30 minutes is flagged; the item is re-checked at post time (Kids or unpublished = cancelled); the cap
// holds at post time; metrics for the last 7 days tolerate failures; with SOCIAL_ENABLED off nothing runs.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { distribution, socialItem, statusOf } from '../helpers/social';
import { seedReference } from '@/db/seed';
import { postText } from '@/lib/social/copy';
import { nextStatus } from '@/lib/social/states';
import { runPoster, recoverStuck } from '@/lib/social/poster';
import { collectMetrics } from '@/lib/social/metrics';
import { socialTick } from '@/lib/jobs/social';
import { SocialPostError, type PlatformAdapter } from '@/lib/social/adapters/meta';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-05T12:00:00Z');
const env = { META_PAGE_ACCESS_TOKEN: 'tok', META_PAGE_ID: '111', META_IG_USER_ID: '222' };

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
  await db.query('DELETE FROM failed_jobs');
  await db.query("DELETE FROM job_runs WHERE job LIKE 'social%'");
  await db.query("UPDATE social_platforms SET enabled = true, daily_cap = 3");
});

function fakeAdapter(results: (Error | { externalId: string; url: string | null })[] = []) {
  const posts: { text: string; imageUrl: string }[] = [];
  const adapter: PlatformAdapter = {
    post: vi.fn(async (d) => {
      posts.push(d);
      const r = results.shift() ?? { externalId: `X${posts.length}`, url: `https://social.example/p/${posts.length}` };
      if (r instanceof Error) throw r;
      return r;
    }),
    metrics: vi.fn(async () => ({ reach: 10 })),
  };
  return { adapter, posts };
}
const deps = (a: PlatformAdapter, e: Record<string, string> = env) => ({ env: e, fetch: vi.fn() as never, adapters: { instagram: a, facebook: a } });

async function due(platform = 'instagram', o: Parameters<typeof socialItem>[1] = {}, at = '2026-11-05T11:00:00Z') {
  const item = await socialItem(db, { kind: 'quiz', ...o });
  return distribution(db, item, platform, { status: 'scheduled', scheduledFor: at, caption: 'Spot it!' });
}
const row = async (id: number) =>
  (
    await db.query<{ status: string; attempts: number; scheduled_for: Date | null; post_url: string | null; external_id: string | null; last_error: string | null; posted_at: Date | null }>(
      'SELECT status, attempts, scheduled_for, post_url, external_id, last_error, posted_at FROM distributions WHERE id = $1',
      [id],
    )
  ).rows[0];
const alerts = async () => (await db.query<{ job: string; error: string }>('SELECT job, error FROM failed_jobs ORDER BY id')).rows;

describe('runPoster', () => {
  it('posts a due row with exactly the stored text and image URL and records the result', async () => {
    const id = await due('facebook');
    const { adapter, posts } = fakeAdapter();
    expect(await runPoster(db, NOW, deps(adapter))).toMatchObject({ posted: 1 });
    const stored = (await db.query<{ caption: string; hashtags: string[]; link: string; image_url: string }>('SELECT caption, hashtags, link, image_url FROM distributions WHERE id = $1', [id])).rows[0];
    expect(posts).toEqual([{ text: postText('facebook', stored), imageUrl: stored.image_url }]);
    expect(await row(id)).toMatchObject({ status: 'posted', attempts: 1, external_id: 'X1', post_url: 'https://social.example/p/1', last_error: null });
    expect((await row(id)).posted_at?.toISOString()).toBe(NOW.toISOString());
  });

  it('leaves rows not yet due, on a disabled platform, or without an adapter (TikTok, YouTube) alone', async () => {
    const later = await due('instagram', {}, '2026-11-05T13:00:00Z');
    const off = await due('facebook');
    const tiktok = await due('tiktok');
    await db.query("UPDATE social_platforms SET enabled = false WHERE platform = 'facebook'");
    const { adapter } = fakeAdapter();
    await runPoster(db, NOW, deps(adapter));
    expect(adapter.post).not.toHaveBeenCalled();
    for (const id of [later, off, tiktok]) expect(await statusOf(db, id)).toBe('scheduled');
  });

  it('missing credentials leave the row scheduled (attempts unchanged) and report the platform', async () => {
    const id = await due('instagram');
    const { adapter } = fakeAdapter();
    const r = await runPoster(db, NOW, deps(adapter, { META_PAGE_ACCESS_TOKEN: 'tok', META_PAGE_ID: '111' }));
    expect(r.noCredentials).toEqual(['instagram']);
    expect(adapter.post).not.toHaveBeenCalled();
    expect(await row(id)).toMatchObject({ status: 'scheduled', attempts: 0 });
  });

  it('a transient failure is retried 3 times, 5 minutes apart, then the row fails with one alert', async () => {
    const id = await due();
    const transient = () => new SocialPostError('transient', 'Meta answered HTTP 503');
    const { adapter } = fakeAdapter([transient(), transient(), transient(), transient()]);
    let t = NOW;
    for (let i = 1; i <= 3; i++) {
      await runPoster(db, t, deps(adapter));
      const r = await row(id);
      expect(r).toMatchObject({ status: 'scheduled', attempts: i, last_error: 'Meta answered HTTP 503' });
      expect(r.scheduled_for?.getTime()).toBe(t.getTime() + 5 * 60_000);
      await runPoster(db, new Date(t.getTime() + 4 * 60_000), deps(adapter)); // not due yet
      t = new Date(t.getTime() + 5 * 60_000);
    }
    await runPoster(db, t, deps(adapter));
    expect(await row(id)).toMatchObject({ status: 'failed', attempts: 4 });
    expect(adapter.post).toHaveBeenCalledTimes(4);
    expect(await alerts()).toHaveLength(1);
  });

  it('a permanent failure fails at once and raises exactly one alert, with no token or caption in it', async () => {
    const id = await due();
    const { adapter } = fakeAdapter([new SocialPostError('permanent', 'Meta answered HTTP 400 (code 100)')]);
    await runPoster(db, NOW, deps(adapter));
    expect(await row(id)).toMatchObject({ status: 'failed', attempts: 1 });
    const a = await alerts();
    expect(a).toHaveLength(1);
    expect(a[0].job).toBe('social-post');
    expect(a[0].error).not.toMatch(/tok|Spot it/);
  });

  it('an ambiguous failure (the platform may have posted) is flagged, alerted and never retried', async () => {
    const id = await due();
    const { adapter } = fakeAdapter([new SocialPostError('ambiguous', 'Meta request timed out')]);
    await runPoster(db, NOW, deps(adapter));
    expect(await statusOf(db, id)).toBe('flagged');
    await runPoster(db, new Date(NOW.getTime() + 3_600_000), deps(adapter));
    expect(adapter.post).toHaveBeenCalledTimes(1);
    expect(await alerts()).toHaveLength(1);
  });

  it('5A review H1: once the platform accepted the post, a failing database write flags the row; it is never posted again', async () => {
    const id = await due();
    const { adapter } = fakeAdapter();
    let failOnce = true;
    const flaky = {
      ...db,
      query: (text: string, params?: unknown[]) => {
        if (failOnce && params?.[1] === 'posted') {
          failOnce = false;
          return Promise.reject(new Error('connection reset'));
        }
        return db.query(text, params as unknown[]);
      },
    } as typeof db;
    await runPoster(flaky, NOW, deps(adapter));
    expect(['flagged', 'posting']).toContain(await statusOf(db, id));
    await runPoster(db, new Date(NOW.getTime() + 3_600_000), deps(adapter));
    await recoverStuck(db, new Date(NOW.getTime() + 3_600_000));
    await runPoster(db, new Date(NOW.getTime() + 7_200_000), deps(adapter));
    expect(adapter.post).toHaveBeenCalledTimes(1);
    expect(await statusOf(db, id)).toBe('flagged');
  });

  it('5A review H1: an error in the re-check after posting flags the row, never defers or fails it', async () => {
    const id = await due();
    const { adapter } = fakeAdapter();
    let calls = 0;
    const flaky = {
      ...db,
      query: (text: string, params?: unknown[]) => {
        if (/FROM items i JOIN worlds/.test(text) && ++calls === 2) return Promise.reject(new Error('timeout'));
        return db.query(text, params as unknown[]);
      },
    } as typeof db;
    await runPoster(flaky, NOW, deps(adapter));
    expect(await statusOf(db, id)).toBe('flagged');
    await runPoster(db, new Date(NOW.getTime() + 3_600_000), deps(adapter));
    expect(adapter.post).toHaveBeenCalledTimes(1);
  });

  it('5A review H1: an ambiguous adapter answer (a 200 without a usable id) is flagged and the owner is not offered Retry', async () => {
    const id = await due('facebook');
    const { adapter } = fakeAdapter([new SocialPostError('ambiguous', 'Meta returned no usable id')]);
    await runPoster(db, NOW, deps(adapter));
    expect(await statusOf(db, id)).toBe('flagged');
    expect(nextStatus('flagged', 'retry')).toBeNull();
  });

  it('two concurrent ticks post a row once', async () => {
    const id = await due();
    const { adapter } = fakeAdapter();
    await Promise.all([runPoster(db, NOW, deps(adapter)), runPoster(db, NOW, deps(adapter)), runPoster(db, NOW, deps(adapter))]);
    expect(adapter.post).toHaveBeenCalledTimes(1);
    expect(await statusOf(db, id)).toBe('posted');
  });

  it('re-checks the item at post time: unpublished, Kids by audience or a world move to Kids cancel it unposted', async () => {
    const ids = [await due(), await due(), await due()];
    await db.query("UPDATE items SET status = 'archived' WHERE id = (SELECT item_id FROM distributions WHERE id = $1)", [ids[0]]);
    await db.query("UPDATE items SET audience = 'kids', approved_by = 'owner' WHERE id = (SELECT item_id FROM distributions WHERE id = $1)", [ids[1]]);
    await db.query("UPDATE items SET world_id = (SELECT id FROM worlds WHERE slug = 'kids') WHERE id = (SELECT item_id FROM distributions WHERE id = $1)", [ids[2]]);
    const { adapter } = fakeAdapter();
    expect(await runPoster(db, NOW, deps(adapter))).toMatchObject({ cancelled: 3, posted: 0 });
    expect(adapter.post).not.toHaveBeenCalled();
    for (const id of ids) expect(await statusOf(db, id)).toBe('cancelled');
  });

  it('holds the cap at post time: past the day\'s posts it moves to the next day\'s time, attempt not counted', async () => {
    await db.query("UPDATE social_platforms SET daily_cap = 1, post_time_utc = '12:00' WHERE platform = 'instagram'");
    const done = await socialItem(db);
    await distribution(db, done, 'instagram', { status: 'posted', postedAt: '2026-11-05T09:00:00Z' });
    const id = await due();
    const { adapter } = fakeAdapter();
    await runPoster(db, NOW, deps(adapter));
    expect(adapter.post).not.toHaveBeenCalled();
    const r = await row(id);
    expect(r).toMatchObject({ status: 'scheduled', attempts: 0 });
    expect(r.scheduled_for?.toISOString()).toBe('2026-11-06T12:00:00.000Z');
  });

  it('an item archived while the post was in flight is flagged after posting', async () => {
    const id = await due();
    const adapter: PlatformAdapter = {
      post: vi.fn(async () => {
        await db.query("UPDATE items SET status = 'archived' WHERE id = (SELECT item_id FROM distributions WHERE id = $1)", [id]);
        return { externalId: 'X', url: 'https://social.example/p/x' };
      }),
      metrics: vi.fn(),
    };
    await runPoster(db, NOW, deps(adapter));
    expect(await row(id)).toMatchObject({ status: 'flagged', post_url: 'https://social.example/p/x' });
  });

  it('with SOCIAL_ENABLED off it does nothing', async () => {
    const id = await due();
    vi.stubEnv('SOCIAL_ENABLED', '');
    const { adapter } = fakeAdapter();
    await runPoster(db, NOW, deps(adapter));
    expect(adapter.post).not.toHaveBeenCalled();
    expect(await statusOf(db, id)).toBe('scheduled');
  });
});

describe('recoverStuck', () => {
  it('flags a row left in posting for 30 minutes, with an alert; a younger one is left; neither is retried', async () => {
    const item = await socialItem(db);
    const old = await distribution(db, item, 'instagram', { status: 'posting', caption: 'x' });
    const young = await distribution(db, await socialItem(db), 'instagram', { status: 'posting', caption: 'x' });
    await db.query("UPDATE distributions SET updated_at = $2 WHERE id = $1", [old, '2026-11-05T11:29:00Z']);
    await db.query("UPDATE distributions SET updated_at = $2 WHERE id = $1", [young, '2026-11-05T11:45:00Z']);
    expect(await recoverStuck(db, NOW)).toBe(1);
    expect(await statusOf(db, old)).toBe('flagged');
    expect(await statusOf(db, young)).toBe('posting');
    expect(await alerts()).toHaveLength(1);
    const { adapter } = fakeAdapter();
    await runPoster(db, NOW, deps(adapter));
    expect(adapter.post).not.toHaveBeenCalled();
  });
});

describe('collectMetrics', () => {
  it('stores metrics for posts of the last 7 days and tolerates one failing', async () => {
    const recent = await distribution(db, await socialItem(db), 'instagram', { status: 'posted', postedAt: '2026-11-03T12:00:00Z', caption: 'x' });
    const broken = await distribution(db, await socialItem(db), 'facebook', { status: 'posted', postedAt: '2026-11-04T12:00:00Z', caption: 'x' });
    const old = await distribution(db, await socialItem(db), 'instagram', { status: 'posted', postedAt: '2026-10-25T12:00:00Z', caption: 'x' });
    await db.query("UPDATE distributions SET external_id = 'E' || id");
    const ok: PlatformAdapter = { post: vi.fn(), metrics: vi.fn(async () => ({ reach: 42, likes: 3 })) };
    const bad: PlatformAdapter = { post: vi.fn(), metrics: vi.fn(async () => { throw new SocialPostError('transient', 'HTTP 500'); }) };
    const r = await collectMetrics(db, NOW, { env, fetch: vi.fn() as never, adapters: { instagram: ok, facebook: bad } });
    expect(r).toEqual({ updated: 1, failed: 1 });
    const m = async (id: number) => (await db.query<{ metrics: unknown }>('SELECT metrics FROM distributions WHERE id = $1', [id])).rows[0].metrics;
    expect(await m(recent)).toEqual({ reach: 42, likes: 3 });
    expect(await m(broken)).toBeNull();
    expect(await m(old)).toBeNull();
  });
});

describe('socialTick', () => {
  it('with SOCIAL_ENABLED off runs nothing and writes nothing', async () => {
    vi.stubEnv('SOCIAL_ENABLED', '');
    await socialItem(db);
    const log: string[] = [];
    await socialTick(db, new Date('2026-11-05T12:00:00Z'), env, log, { fetch: vi.fn() as never });
    expect(log).toEqual([]);
    expect((await db.query('SELECT 1 FROM distributions')).rows).toEqual([]);
    expect((await db.query("SELECT 1 FROM job_runs WHERE job LIKE 'social%'")).rows).toEqual([]);
  });

  it('selects for Instagram and Facebook only (TikTok and YouTube are Part B), posts on the 5-minute mark', async () => {
    await socialItem(db, { publishedAt: '2026-11-05T06:00:00Z' });
    const log: string[] = [];
    await socialTick(db, new Date('2026-11-05T12:00:00Z'), env, log, { fetch: vi.fn() as never });
    const platforms = (await db.query<{ platform: string }>('SELECT DISTINCT platform FROM distributions ORDER BY platform')).rows.map((x) => x.platform);
    expect(platforms).toEqual(['facebook', 'instagram']);
    expect(log.join('; ')).toMatch(/social select/);
    expect(log.join('; ')).toMatch(/social post/);
    const later: string[] = [];
    await socialTick(db, new Date('2026-11-05T12:03:00Z'), env, later, { fetch: vi.fn() as never });
    expect(later.join('; ')).not.toMatch(/social post/);
  });
});
