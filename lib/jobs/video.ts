// The video tick (plan 5B; 5B review M4), run every 5 minutes by its own systemd timer (sparkkindly-video-poster*.timer,
// worker/video.ts), never by the one-minute worker: uploads of up to 256 MB need more time and memory than the worker
// unit allows. With SOCIAL_ENABLED on: the daily video selection for TikTok and YouTube (claimed once per platform and
// UTC day), stuck video rows recovered after 45 minutes, unknown TikTok outcomes polled again, the video poster, daily
// video metrics and the daily media purge (each claimed in job_runs). Each step goes through runJob, so a failure is one
// failed_jobs row and never stops the rest. No Next.js imports. Verified by tests/unit/social-video-poster.test.ts.
import type { Db, Queryable } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { socialEnabled } from '@/lib/config';
import type { VideoAdapter } from '@/lib/social/adapters/video';
import { recoverStuck } from '@/lib/social/poster';
import { VIDEO_PLATFORMS, type VideoPlatform } from '@/lib/social/states';
import { collectVideoMetrics, resumeVideoPolls, runVideoPoster, VIDEO_ADAPTERS } from '@/lib/social/video/poster';
import { selectVideos } from '@/lib/social/video/select';
import { mediaDirs } from '@/lib/social/video/storage';
import { runJob } from './run-job';
import { purgeCancelledMedia, purgePostedMedia, purgeQuarantine } from './video-purge';

export type VideoOpts = { fetch: typeof fetch; adapters?: Partial<Record<VideoPlatform, VideoAdapter>>; delayMs?: number };

async function claimDaily(db: Queryable, job: string, day: string): Promise<boolean> {
  const r = await db.query('INSERT INTO job_runs (job, run_key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING run_key', [job, day]);
  return r.rows.length === 1;
}

async function post(db: Db, now: Date, log: string[], deps: Parameters<typeof runVideoPoster>[2]): Promise<void> {
  const stuck = await recoverStuck(db, now, { video: true });
  const resumed = await resumeVideoPolls(db, now, deps);
  const v = await runVideoPoster(db, now, deps);
  const missing = v.noCredentials.length ? `, no credentials: ${v.noCredentials.join(' ')}` : '';
  log.push(
    `video post: ${v.posted} posted, ${v.deferred} deferred, ${v.failed} failed, ${v.cancelled} cancelled, ${v.flagged + stuck} flagged${missing}; ` +
      `resumed ${resumed.posted} posted, ${resumed.failed} failed, ${resumed.pending} pending`,
  );
}

export async function videoTick(db: Db, now: Date, env: EnvLike, log: string[], o: VideoOpts): Promise<void> {
  if (!socialEnabled()) return;
  const day = now.toISOString().slice(0, 10);
  const deps = { env, fetch: o.fetch, adapters: o.adapters ?? VIDEO_ADAPTERS };
  await runJob(db, 'video-select', async () => {
    for (const platform of VIDEO_PLATFORMS) {
      const r = await selectVideos(db, platform, day, now);
      log.push(`video select ${platform}: ${r.selected} selected, ${r.skipped} skipped`);
    }
  }, { delayMs: o.delayMs });
  await runJob(db, 'video-post', () => post(db, now, log, deps), { delayMs: o.delayMs });
  if (await claimDaily(db, 'video-metrics', day).catch(() => false)) {
    await runJob(db, 'video-metrics', async () => {
      const r = await collectVideoMetrics(db, now, deps);
      log.push(`video metrics: ${r.updated} updated, ${r.failed} failed`);
    }, { delayMs: o.delayMs });
  }
  if (await claimDaily(db, 'video-purge', day).catch(() => false)) {
    await runJob(db, 'video-purge', async () => {
      const dirs = mediaDirs(env);
      const q = await purgeQuarantine(dirs, now);
      const c = await purgeCancelledMedia(db, dirs, now);
      const p = await purgePostedMedia(db, dirs, now);
      log.push(`video purge: ${q} quarantine file(s), ${c} cancelled and ${p} posted job(s)`);
    }, { delayMs: o.delayMs });
  }
}
