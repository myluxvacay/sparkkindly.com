// @vitest-environment node
// The video jobs queue, part 1 (plan 5B Task 1) on PGlite: the video_jobs table, every legal and illegal video state
// transition, and the daily video selection (only eligible, published video_script items, TikTok and YouTube only, the
// 5A caps, rotation and skip reasons, Kids never, idempotent) with one brief_pending job per selected item.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { distribution, socialItem } from '../helpers/social';
import { seedReference } from '@/db/seed';
import { selectVideos } from '@/lib/social/video/select';
import { moveVideoJob, nextVideoState, VIDEO_EVENTS, VIDEO_STATES, type VideoEvent, type VideoState } from '@/lib/social/video/states';
import { handPick, selectForDay } from '@/lib/social/select';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const DAY = '2026-11-05';
const NOW = new Date('2026-11-05T06:00:00Z');
const video = (o: Parameters<typeof socialItem>[1] = {}) => socialItem(db, { kind: 'video_script', ...o });

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
  await db.query('DELETE FROM job_runs');
  await db.query('DELETE FROM items');
  await db.query("UPDATE social_platforms SET enabled = true, daily_cap = CASE platform WHEN 'instagram' THEN 2 WHEN 'facebook' THEN 3 ELSE 1 END");
});

const jobs = async (platform: string) =>
  (
    await db.query<{ item_id: string; state: string; version: number; dstatus: string; distribution_id: string }>(
      `SELECT j.item_id, j.state, j.version, d.status AS dstatus, j.distribution_id FROM video_jobs j
       JOIN distributions d ON d.id = j.distribution_id WHERE j.platform = $1 ORDER BY j.id`,
      [platform],
    )
  ).rows;
const dists = async (platform: string) =>
  (await db.query<{ item_id: string; status: string; skip_reason: string | null }>('SELECT item_id, status, skip_reason FROM distributions WHERE platform = $1 ORDER BY id', [platform])).rows;

describe('video_jobs table', () => {
  it('allows TikTok and YouTube only, one job per item and platform, and follows its distribution on delete', async () => {
    const item = await video();
    const d = await distribution(db, item, 'tiktok');
    await db.query("INSERT INTO video_jobs (item_id, platform, distribution_id) VALUES ($1, 'tiktok', $2)", [item, d]);
    await expect(db.query("INSERT INTO video_jobs (item_id, platform, distribution_id) VALUES ($1, 'tiktok', $2)", [item, d])).rejects.toThrow();
    const ig = await distribution(db, item, 'instagram');
    await expect(db.query("INSERT INTO video_jobs (item_id, platform, distribution_id) VALUES ($1, 'instagram', $2)", [item, ig])).rejects.toThrow();
    await expect(db.query("UPDATE video_jobs SET file_name = '../../etc/passwd'")).rejects.toThrow();
    await expect(db.query("UPDATE video_jobs SET maker_note = $1", ['x'.repeat(101)])).rejects.toThrow();
    await expect(db.query("UPDATE video_jobs SET state = 'approved'")).rejects.toThrow(); // approval needs the checksum
    await db.query('DELETE FROM distributions WHERE id = $1', [d]);
    expect((await db.query('SELECT 1 FROM video_jobs')).rows).toEqual([]);
  });
});

describe('video state machine', () => {
  const LEGAL: Record<VideoEvent, [VideoState[], VideoState]> = {
    brief: [['brief_pending'], 'brief_ready'],
    upload: [['brief_ready', 'uploaded'], 'uploaded'],
    approve: [['uploaded'], 'approved'],
    cancel: [['brief_pending', 'brief_ready', 'uploaded', 'approved'], 'cancelled'],
  };

  it('allows exactly the listed moves and refuses every other', () => {
    expect(Object.keys(VIDEO_EVENTS).sort()).toEqual(Object.keys(LEGAL).sort());
    for (const event of Object.keys(LEGAL) as VideoEvent[]) {
      for (const state of VIDEO_STATES) {
        const [from, to] = LEGAL[event];
        expect(nextVideoState(state, event), `${state} --${event}`).toBe(from.includes(state) ? to : null);
      }
    }
    expect(nextVideoState('brief_pending', 'toString' as VideoEvent)).toBeNull();
    expect(nextVideoState('cancelled', 'brief')).toBeNull();
  });

  it('moveVideoJob is conditional on state and version and bumps the version', async () => {
    const item = await video();
    const d = await distribution(db, item, 'youtube');
    const id = Number((await db.query<{ id: string }>("INSERT INTO video_jobs (item_id, platform, distribution_id) VALUES ($1, 'youtube', $2) RETURNING id", [item, d])).rows[0].id);
    expect(await moveVideoJob(db, id, 'approve')).toBe(false);
    expect(await moveVideoJob(db, id, 'brief', { version: 2 })).toBe(false);
    expect(await moveVideoJob(db, id, 'brief', { version: 1, set: { brief: JSON.stringify({ narration: 'x' }) } })).toBe(true);
    expect(await moveVideoJob(db, id, 'brief', { version: 2 })).toBe(false);
    expect((await jobs('youtube'))[0]).toMatchObject({ state: 'brief_ready', version: 2 });
    await expect(moveVideoJob(db, id, 'cancel', { set: { 'state = 1; --': 1 } })).rejects.toThrow();
  });
});

describe('selectVideos', () => {
  it('picks up to the cap, records the rest as skipped, and creates one brief_pending job per pick', async () => {
    const a = await video({ world: 'play' });
    const b = await video({ world: 'grow' });
    expect(await selectVideos(db, 'tiktok', DAY, NOW)).toEqual({ selected: 1, skipped: 1 });
    const by = Object.fromEntries((await dists('tiktok')).map((x) => [x.item_id, x]));
    expect(by[b].status).toBe('selected'); // grow before play by slug, no world has posted
    expect(by[a]).toMatchObject({ status: 'skipped', skip_reason: 'world_rotation' });
    const j = await jobs('tiktok');
    expect(j).toEqual([expect.objectContaining({ item_id: b, state: 'brief_pending', version: 1, dstatus: 'selected' })]);
  });

  it('considers only eligible video scripts: never Kids, articles, quizzes, unpublished or future items', async () => {
    await video({ world: 'kids' });
    await video({ world: 'play', audience: 'kids' });
    await video({ world: 'play', riskTier: 'kids' });
    await video({ status: 'draft' });
    await video({ status: 'archived' });
    await video({ status: 'scheduled', publishedAt: '2026-11-06T00:00:00Z' });
    await video({ publishedAt: '2026-11-05T07:00:00Z' });
    await socialItem(db, { kind: 'quiz' });
    await socialItem(db, { kind: 'article' });
    expect(await selectVideos(db, 'youtube', DAY, NOW)).toEqual({ selected: 0, skipped: 0 });
    expect(await dists('youtube')).toEqual([]);
    expect(await jobs('youtube')).toEqual([]);
  });

  it('refuses Instagram and Facebook, a disabled platform and SOCIAL_ENABLED off', async () => {
    await video();
    for (const p of ['instagram', 'facebook'] as never[]) expect(await selectVideos(db, p, DAY, NOW)).toEqual({ selected: 0, skipped: 0 });
    await db.query("UPDATE social_platforms SET enabled = false WHERE platform = 'tiktok'");
    expect(await selectVideos(db, 'tiktok', DAY, NOW)).toEqual({ selected: 0, skipped: 0 });
    vi.stubEnv('SOCIAL_ENABLED', '');
    expect(await selectVideos(db, 'youtube', DAY, NOW)).toEqual({ selected: 0, skipped: 0 });
    expect((await db.query('SELECT 1 FROM distributions')).rows).toEqual([]);
  });

  it('is idempotent per platform and day, and an item gets a job per platform at most once', async () => {
    const a = await video();
    await selectVideos(db, 'tiktok', DAY, NOW);
    await video({ world: 'grow' });
    expect(await selectVideos(db, 'tiktok', DAY, NOW)).toEqual({ selected: 0, skipped: 0 });
    expect(await selectVideos(db, 'tiktok', '2026-11-06', new Date('2026-11-06T06:00:00Z'))).toEqual({ selected: 1, skipped: 0 });
    expect((await jobs('tiktok')).map((j) => j.item_id)).toContain(a);
    expect(await jobs('tiktok')).toHaveLength(2);
    expect(await selectVideos(db, 'youtube', DAY, NOW)).toEqual({ selected: 1, skipped: 1 });
  });

  it('the 5A text selection never picks a video script, and a hand-pick to a video platform is refused', async () => {
    const v = await video();
    const a = await socialItem(db, { kind: 'quiz' });
    expect(await selectForDay(db, 'instagram', DAY, NOW)).toEqual({ selected: 1, skipped: 0 });
    expect(await handPick(db, a, 'tiktok', NOW)).toEqual({ ok: false, reason: 'platform' });
    expect(await handPick(db, v, 'youtube', NOW)).toEqual({ ok: false, reason: 'platform' });
  });
});
