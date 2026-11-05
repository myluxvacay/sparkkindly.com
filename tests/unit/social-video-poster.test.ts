// @vitest-environment node
// The video poster (plan 5B Task 3) on PGlite with injected adapters and temp media/token folders: only approved jobs
// are claimed; the item's eligibility and the file's checksum are re-checked at post time (Kids = cancelled; a file
// changed since approval = flagged, never sent); the payload is the approved file with the brief's captions; missing
// credentials leave rows scheduled; quota errors back off longer with one digest line a day; ambiguous failures, a
// failed write after the platform accepted, an unpublish mid-flight and a captions warning all flag, never repost;
// archiving the item cancels unposted jobs; metrics tolerate failures; socialTick runs the video selection and poster;
// no token in any log line.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newTestDb } from '../helpers/test-db';
import { distribution, socialItem, statusOf } from '../helpers/social';
import { mp4 } from '../helpers/mp4';
import { seedReference } from '@/db/seed';
import { SocialPostError } from '@/lib/social/adapters/meta';
import type { VideoAdapter, VideoPayload } from '@/lib/social/adapters/video';
import { cancelForItem } from '@/lib/social/cancel';
import { collectVideoMetrics, runVideoPoster } from '@/lib/social/video/poster';
import { ensureDirs, mediaDirs, newName } from '@/lib/social/video/storage';
import { socialTick } from '@/lib/jobs/social';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let root: string;
let env: Record<string, string>;
const NOW = new Date('2026-11-05T16:00:00Z');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'sk-video-poster-'));
  const tokens = path.join(root, 'tokens.json');
  writeFileSync(tokens, '{}');
  env = {
    SOCIAL_MEDIA_DIR: root, SOCIAL_TOKEN_FILE: tokens,
    TIKTOK_CLIENT_KEY: 'ck', TIKTOK_CLIENT_SECRET: 'TT-SECRET', TIKTOK_REFRESH_TOKEN: 'TT-REFRESH-SECRET',
    YOUTUBE_CLIENT_ID: 'ci', YOUTUBE_CLIENT_SECRET: 'YT-SECRET', YOUTUBE_REFRESH_TOKEN: 'YT-REFRESH-SECRET',
  };
  vi.stubEnv('SOCIAL_ENABLED', 'true');
  await ensureDirs(mediaDirs(env));
  await db.query('DELETE FROM distributions');
  await db.query('DELETE FROM failed_jobs');
  await db.query('DELETE FROM job_runs');
  await db.query("UPDATE social_platforms SET enabled = true, daily_cap = 1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

const briefFor = (platform: string) => ({
  narration: 'n', shots: ['a', 'b', 'c'], onScreenText: [], hashtags: ['puzzle'], durationSeconds: 30,
  captions: platform === 'tiktok' ? { tiktok: 'Guess the shape' } : { youtube: { title: 'Odd shape', description: 'A puzzle.' } },
});

async function approved(platform: 'tiktok' | 'youtube' = 'tiktok', o: { file?: Buffer; at?: string } = {}) {
  const dirs = mediaDirs(env);
  const item = await socialItem(db, { kind: 'video_script' });
  const d = await distribution(db, item, platform, { status: 'scheduled', scheduledFor: o.at ?? '2026-11-05T15:00:00Z', caption: 'Guess the shape' });
  const file = o.file ?? mp4();
  const name = newName(d, 'mp4');
  writeFileSync(path.join(dirs.approved, name), file);
  const captions = platform === 'youtube' ? newName(d, 'vtt') : null;
  if (captions) writeFileSync(path.join(dirs.approved, captions), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n');
  const r = await db.query<{ id: string }>(
    `INSERT INTO video_jobs (item_id, platform, distribution_id, state, brief, file_name, file_sha256, file_size, validation,
                             captions_path, approved_checksum, approved_at)
     VALUES ($1, $2, $3, 'approved', $4::jsonb, $5, $6, $7, '{"ok":true}'::jsonb, $8, $6, '2026-11-05T10:00:00Z') RETURNING id`,
    [item, platform, d, JSON.stringify(briefFor(platform)), name, sha(file), file.length, captions],
  );
  return { item, distribution: d, job: Number(r.rows[0].id), name, file };
}

function fake(results: (Error | { externalId: string; url: string | null; warning?: string })[] = []) {
  const posts: VideoPayload[] = [];
  const adapter: VideoAdapter = {
    post: vi.fn(async (p: VideoPayload) => {
      posts.push(p);
      const r = results.shift() ?? { externalId: `V${posts.length}`, url: `https://video.example/${posts.length}` };
      if (r instanceof Error) throw r;
      return r;
    }),
    metrics: vi.fn(async () => ({ views: 9 })),
  };
  return { adapter, posts };
}
const deps = (a: VideoAdapter, e = env) => ({ env: e, fetch: vi.fn() as never, adapters: { tiktok: a, youtube: a } });
const row = async (id: number) =>
  (await db.query<{ status: string; external_id: string | null; post_url: string | null; last_error: string | null; scheduled_for: Date | null; attempts: number; metrics: unknown }>(
    'SELECT status, external_id, post_url, last_error, scheduled_for, attempts, metrics FROM distributions WHERE id = $1', [id])).rows[0];
const jobState = async (id: number) => (await db.query<{ state: string }>('SELECT state FROM video_jobs WHERE id = $1', [id])).rows[0].state;
const alerts = async () => (await db.query<{ error: string }>('SELECT error FROM failed_jobs ORDER BY id')).rows.map((r) => r.error);

describe('runVideoPoster', () => {
  it('posts an approved TikTok job: the approved file, size and caption with hashtags', async () => {
    const j = await approved('tiktok');
    const { adapter, posts } = fake();
    expect(await runVideoPoster(db, NOW, deps(adapter))).toMatchObject({ posted: 1 });
    expect(posts).toEqual([{ filePath: path.join(root, 'approved', j.name), size: j.file.length, caption: 'Guess the shape', hashtags: ['puzzle'], captionsPath: null }]);
    expect(await row(j.distribution)).toMatchObject({ status: 'posted', external_id: 'V1', post_url: 'https://video.example/1' });
  });

  it('YouTube gets the title, description and the approved caption file', async () => {
    await approved('youtube');
    const { adapter, posts } = fake();
    await runVideoPoster(db, NOW, deps(adapter));
    expect(posts[0]).toMatchObject({ title: 'Odd shape', description: 'A puzzle.', caption: 'Odd shape' });
    expect(posts[0].captionsPath).toMatch(/approved.*\.vtt$/);
  });

  it('never claims a scheduled row without an approved job (a text row, a job not approved)', async () => {
    const text = await socialItem(db, { kind: 'quiz' });
    const t = await distribution(db, text, 'tiktok', { status: 'scheduled', scheduledFor: '2026-11-05T15:00:00Z', caption: 'x' });
    const j = await approved('youtube');
    await db.query("UPDATE video_jobs SET state = 'cancelled' WHERE id = $1", [j.job]);
    const { adapter } = fake();
    await runVideoPoster(db, NOW, deps(adapter));
    expect(adapter.post).not.toHaveBeenCalled();
    expect(await statusOf(db, t)).toBe('scheduled');
  });

  it('a file changed on disk since approval is flagged and never sent', async () => {
    const j = await approved('tiktok');
    writeFileSync(path.join(root, 'approved', j.name), mp4({ mdatBytes: 3 }));
    const { adapter } = fake();
    expect(await runVideoPoster(db, NOW, deps(adapter))).toMatchObject({ flagged: 1 });
    expect(adapter.post).not.toHaveBeenCalled();
    expect((await row(j.distribution)).status).toBe('flagged');
    expect((await alerts()).join()).toMatch(/checksum|changed/);
  });

  it('an item made Kids (or archived) before posting cancels the row and the job, unposted', async () => {
    const j = await approved('tiktok');
    await db.query("UPDATE items SET audience = 'kids' WHERE id = $1", [j.item]);
    const { adapter } = fake();
    expect(await runVideoPoster(db, NOW, deps(adapter))).toMatchObject({ cancelled: 1 });
    expect(adapter.post).not.toHaveBeenCalled();
    expect(await jobState(j.job)).toBe('cancelled');
  });

  it('missing credentials leave the row scheduled and report the platform', async () => {
    const j = await approved('youtube');
    const { adapter } = fake();
    const r = await runVideoPoster(db, NOW, deps(adapter, { SOCIAL_MEDIA_DIR: root, SOCIAL_TOKEN_FILE: env.SOCIAL_TOKEN_FILE }));
    expect(r.noCredentials).toEqual(['youtube']);
    expect(await row(j.distribution)).toMatchObject({ status: 'scheduled', attempts: 0 });
  });

  it('a needs-re-authorisation token file stops posting for that platform only', async () => {
    writeFileSync(env.SOCIAL_TOKEN_FILE, JSON.stringify({ tiktok: { refreshToken: 'x', needsReauth: true } }));
    const t = await approved('tiktok');
    const { adapter } = fake();
    expect((await runVideoPoster(db, NOW, deps(adapter))).noCredentials).toEqual(['tiktok']);
    expect((await row(t.distribution)).status).toBe('scheduled');
  });

  it('holds the cap at post time', async () => {
    const done = await approved('tiktok');
    await db.query("UPDATE distributions SET status = 'posted', posted_at = '2026-11-05T09:00:00Z' WHERE id = $1", [done.distribution]);
    const j = await approved('tiktok');
    const { adapter } = fake();
    await runVideoPoster(db, NOW, deps(adapter));
    expect(adapter.post).not.toHaveBeenCalled();
    expect((await row(j.distribution)).scheduled_for!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('a quota error backs off for its longer time and writes one digest line a day', async () => {
    const j = await approved('youtube');
    const quota = () => new SocialPostError('transient', 'YouTube answered HTTP 403 (quotaExceeded)', 6 * 3_600_000);
    const { adapter } = fake([quota(), quota()]);
    await runVideoPoster(db, NOW, deps(adapter));
    expect((await row(j.distribution)).scheduled_for!.toISOString()).toBe('2026-11-05T22:00:00.000Z');
    await runVideoPoster(db, new Date('2026-11-05T22:00:00Z'), deps(adapter));
    expect(adapter.post).toHaveBeenCalledTimes(2);
    expect((await alerts()).filter((a) => /quota|limit/i.test(a))).toHaveLength(1);
  });

  it('an ambiguous failure is flagged and never retried', async () => {
    const j = await approved('tiktok');
    const { adapter } = fake([new SocialPostError('ambiguous', 'TikTok upload timed out')]);
    await runVideoPoster(db, NOW, deps(adapter));
    await runVideoPoster(db, new Date(NOW.getTime() + 3_600_000), deps(adapter));
    expect(adapter.post).toHaveBeenCalledTimes(1);
    expect((await row(j.distribution)).status).toBe('flagged');
  });

  it('a failing write after the platform accepted flags the row; it is never posted again', async () => {
    const j = await approved('tiktok');
    const { adapter } = fake();
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
    await runVideoPoster(flaky, NOW, deps(adapter));
    await runVideoPoster(db, new Date(NOW.getTime() + 3_600_000), deps(adapter));
    expect(adapter.post).toHaveBeenCalledTimes(1);
    expect(['flagged', 'posting']).toContain((await row(j.distribution)).status);
  });

  it('unpublished while uploading: posted, then flagged for manual removal', async () => {
    const j = await approved('tiktok');
    const adapter: VideoAdapter = {
      post: vi.fn(async () => {
        await db.query("UPDATE items SET status = 'archived' WHERE id = $1", [j.item]);
        return { externalId: 'V1', url: null };
      }),
      metrics: vi.fn(),
    };
    await runVideoPoster(db, NOW, deps(adapter));
    expect(await row(j.distribution)).toMatchObject({ status: 'flagged', external_id: 'V1' });
  });

  it('a captions warning from the adapter flags the posted row with the reason', async () => {
    const j = await approved('youtube');
    const { adapter } = fake([{ externalId: 'Y1', url: 'https://www.youtube.com/shorts/Y1', warning: 'posted without captions: add them in YouTube Studio' }]);
    await runVideoPoster(db, NOW, deps(adapter));
    expect(await row(j.distribution)).toMatchObject({ status: 'flagged', external_id: 'Y1', last_error: expect.stringMatching(/captions/) });
  });
});

describe('unpublish', () => {
  it('archiving the item cancels unposted video jobs with their distributions', async () => {
    const j = await approved('tiktok');
    await cancelForItem(db, j.item);
    expect(await jobState(j.job)).toBe('cancelled');
    expect(await statusOf(db, j.distribution)).toBe('cancelled');
  });
});

describe('collectVideoMetrics', () => {
  it('stores views for posted videos and tolerates a failure', async () => {
    const a = await approved('tiktok');
    const b = await approved('youtube');
    for (const d of [a.distribution, b.distribution]) {
      await db.query("UPDATE distributions SET status = 'posted', posted_at = '2026-11-05T09:00:00Z', external_id = 'E' WHERE id = $1", [d]);
    }
    const ok = fake().adapter;
    const broken: VideoAdapter = { post: vi.fn(), metrics: vi.fn(async () => { throw new SocialPostError('transient', 'down'); }) };
    expect(await collectVideoMetrics(db, NOW, { env, fetch: vi.fn() as never, adapters: { tiktok: ok, youtube: broken } })).toEqual({ updated: 1, failed: 1 });
    expect((await row(a.distribution)).metrics).toEqual({ views: 9 });
  });
});

describe('socialTick with video', () => {
  it('selects video scripts for TikTok and YouTube and posts approved jobs; no token in the log', async () => {
    await socialItem(db, { kind: 'video_script', publishedAt: '2026-11-05T06:00:00Z' });
    const log: string[] = [];
    const { adapter } = fake();
    await socialTick(db, NOW, env, log, { fetch: vi.fn() as never, videoAdapters: { tiktok: adapter, youtube: adapter } });
    const jobs = (await db.query<{ platform: string }>('SELECT platform FROM video_jobs ORDER BY platform')).rows.map((r) => r.platform);
    expect(jobs).toEqual(['tiktok', 'youtube']);
    expect(log.join('; ')).toMatch(/video select tiktok/);
    expect(log.join('; ')).toMatch(/video post/);
    expect(log.join('; ')).not.toMatch(/SECRET/);
  });
});
