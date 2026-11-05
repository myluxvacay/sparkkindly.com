// The video poster (plan 5B), run by the worker every 5 minutes beside the 5A poster and built from its parts: one due
// row at a time claimed with a conditional UPDATE, but only rows whose video job the owner approved. Before the upload it
// re-reads the item (no longer eligible: the row and the job are cancelled), the day's posts (cap reached: next day)
// and the approved file (it must still hash to the approved checksum, else the row is flagged and nothing is sent). It
// sends exactly the approved file with the brief's caption fields. Failures as in 5A (onError: transient later,
// longer for quotas with one digest line a day; permanent fails; ambiguous flags); after the platform accepted, only
// recordPosted runs (a later error flags, never reposts), and a captions warning flags the posted row. Platforms
// without credentials, or waiting for re-authorisation, are not claimed and are reported. No Next.js imports.
// Verified by tests/unit/social-video-poster.test.ts.
import { socialEnabled } from '@/lib/config';
import type { Queryable } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { hasTiktokCredentials, tiktok } from '../adapters/tiktok';
import { SocialPostError } from '../adapters/meta';
import type { VideoAdapter, VideoPayload } from '../adapters/video';
import { hasYoutubeCredentials, youtube } from '../adapters/youtube';
import { scheduleTime } from '../copy';
import { eligibleItem, videoEligibleWhere } from '../eligibility';
import { deferUnchecked, duePlatforms, failRow, onError, postedToday, recordPosted, tomorrow, type PosterResult } from '../poster';
import { moveDistribution, VIDEO_PLATFORMS, type VideoPlatform } from '../states';
import type { Brief } from './brief';
import { findFile, mediaDirs, sha256File } from './storage';
import { moveVideoJob } from './states';

export type VideoPosterDeps = {
  env: EnvLike;
  fetch: typeof fetch;
  adapters?: Partial<Record<VideoPlatform, VideoAdapter>>;
  sleep?: (ms: number) => Promise<void>;
};

export const VIDEO_ADAPTERS: Record<VideoPlatform, VideoAdapter> = { tiktok, youtube };
const CREDENTIALS: Record<VideoPlatform, (env: EnvLike) => boolean> = { tiktok: hasTiktokCredentials, youtube: hasYoutubeCredentials };
export const hasVideoCredentials = (p: VideoPlatform, env: EnvLike) => CREDENTIALS[p](env);
const PER_RUN = 4;

type Claimed = {
  id: number; item_id: string; platform: VideoPlatform; attempts: number; daily_cap: number; post_time_utc: string;
  job_id: string; brief: Brief; file_name: string; captions_path: string | null; approved_checksum: string; file_size: string;
};

async function claim(db: Queryable, now: Date, platforms: VideoPlatform[]): Promise<Claimed | null> {
  const r = await db.query<Claimed>(
    `WITH c AS (
       UPDATE distributions d SET status = 'posting', attempts = d.attempts + 1, version = d.version + 1, updated_at = $1
       WHERE d.id = (
         SELECT x.id FROM distributions x JOIN social_platforms xp ON xp.platform = x.platform
         JOIN video_jobs xj ON xj.distribution_id = x.id AND xj.state = 'approved'
         WHERE x.status = 'scheduled' AND x.scheduled_for <= $1 AND xp.enabled AND x.platform = ANY($2::text[])
         ORDER BY x.scheduled_for, x.id LIMIT 1 FOR UPDATE OF x SKIP LOCKED)
         AND d.status = 'scheduled'
       RETURNING d.id, d.item_id, d.platform, d.attempts)
     SELECT c.*, p.daily_cap, p.post_time_utc::text AS post_time_utc, j.id AS job_id, j.brief, j.file_name, j.captions_path,
            j.approved_checksum, j.file_size
     FROM c JOIN social_platforms p ON p.platform = c.platform JOIN video_jobs j ON j.distribution_id = c.id`,
    [now.toISOString(), platforms],
  );
  return r.rows[0] ? { ...r.rows[0], id: Number(r.rows[0].id) } : null;
}

// The approved file, still exactly as approved; null otherwise.
async function approvedFile(d: Claimed, env: EnvLike): Promise<{ filePath: string; captionsPath: string | null } | null> {
  const dirs = mediaDirs(env);
  const file = await findFile(dirs, d.file_name).catch(() => null);
  if (file?.where !== 'approved' || (await sha256File(file.path).catch(() => '')) !== d.approved_checksum) return null;
  const captions = d.captions_path ? await findFile(dirs, d.captions_path).catch(() => null) : null;
  return { filePath: file.path, captionsPath: captions?.where === 'approved' ? captions.path : null };
}

function payload(d: Claimed, f: { filePath: string; captionsPath: string | null }): VideoPayload {
  const c = d.brief.captions;
  const base = { filePath: f.filePath, size: Number(d.file_size), hashtags: d.brief.hashtags, captionsPath: f.captionsPath };
  if (d.platform === 'tiktok') return { ...base, caption: c.tiktok ?? '' };
  return { ...base, caption: c.youtube?.title ?? '', title: c.youtube?.title, description: c.youtube?.description };
}

// The checks before the upload; the approved file when the row may go, else null (the row already moved).
async function preflight(db: Queryable, d: Claimed, now: Date, env: EnvLike, r: PosterResult): Promise<{ filePath: string; captionsPath: string | null } | null> {
  if (!(await eligibleItem(db, d.item_id, now, videoEligibleWhere))) {
    await moveDistribution(db, d.id, 'cancel', { set: { last_error: 'item no longer eligible at post time' } });
    await moveVideoJob(db, Number(d.job_id), 'cancel');
    r.cancelled++;
    return null;
  }
  if ((await postedToday(db, d.platform, now)) >= d.daily_cap) {
    const next = scheduleTime(d.post_time_utc, tomorrow(now)).toISOString();
    await moveDistribution(db, d.id, 'defer', { set: { attempts: d.attempts - 1, scheduled_for: next } });
    r.deferred++;
    return null;
  }
  const file = await approvedFile(d, env);
  if (!file) {
    await failRow(db, d, 'flag', 'the approved file is missing or its checksum changed since approval: nothing was sent');
    r.flagged++;
  }
  return file;
}

async function postOne(db: Queryable, d: Claimed, now: Date, deps: VideoPosterDeps, adapter: VideoAdapter, r: PosterResult): Promise<void> {
  let file: Awaited<ReturnType<typeof preflight>>;
  try {
    file = await preflight(db, d, now, deps.env, r);
  } catch {
    await deferUnchecked(db, d, now, r); // a database error before the upload: nothing was sent (5A review L3)
    return;
  }
  if (!file) return;
  let out;
  try {
    out = await adapter.post(payload(d, file), { fetch: deps.fetch, env: deps.env, sleep: deps.sleep, now: () => now });
  } catch (err) {
    await onError(db, d, err, now, r);
    return;
  }
  await recordPosted(db, d, out, now, r, videoEligibleWhere);
  if (out.warning) await failRow(db, d, 'flag', out.warning).catch(() => undefined);
}

export async function runVideoPoster(db: Queryable, now: Date, deps: VideoPosterDeps): Promise<PosterResult> {
  const r: PosterResult = { posted: 0, deferred: 0, failed: 0, cancelled: 0, flagged: 0, noCredentials: [] };
  if (!socialEnabled()) return r;
  const adapters = deps.adapters ?? VIDEO_ADAPTERS;
  const supported = VIDEO_PLATFORMS.filter((p) => adapters[p]);
  const ready = supported.filter((p) => hasVideoCredentials(p, deps.env));
  r.noCredentials = await duePlatforms(db, now, supported.filter((p) => !ready.includes(p)));
  for (let i = 0; i < PER_RUN && ready.length; i++) {
    const d = await claim(db, now, ready);
    if (!d) break;
    await postOne(db, d, now, deps, adapters[d.platform]!, r);
  }
  return r;
}

const WINDOW_MS = 7 * 24 * 3_600_000;

// Daily views, likes and comments for posted videos of the last 7 days; one failure never stops the others.
export async function collectVideoMetrics(db: Queryable, now: Date, deps: VideoPosterDeps): Promise<{ updated: number; failed: number }> {
  const adapters = deps.adapters ?? VIDEO_ADAPTERS;
  const r = await db.query<{ id: string; platform: VideoPlatform; external_id: string }>(
    `SELECT id, platform, external_id FROM distributions
     WHERE status = 'posted' AND external_id IS NOT NULL AND posted_at > $1 AND platform = ANY($2::text[]) ORDER BY posted_at DESC LIMIT 100`,
    [new Date(now.getTime() - WINDOW_MS).toISOString(), [...VIDEO_PLATFORMS]],
  );
  const out = { updated: 0, failed: 0 };
  for (const d of r.rows) {
    const adapter = adapters[d.platform];
    if (!adapter || !hasVideoCredentials(d.platform, deps.env)) continue;
    try {
      const m = await adapter.metrics({ externalId: d.external_id }, { fetch: deps.fetch, env: deps.env, sleep: deps.sleep, now: () => now });
      await db.query('UPDATE distributions SET metrics = $2::jsonb, metrics_at = $3 WHERE id = $1', [d.id, JSON.stringify(m), now.toISOString()]);
      out.updated++;
    } catch (err) {
      console.error(`video metrics: post ${d.id} on ${d.platform} failed:`, err instanceof SocialPostError ? err.message : (err as Error)?.name);
      out.failed++;
    }
  }
  return out;
}
