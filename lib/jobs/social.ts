// The social jobs (plan 5A), called by every worker tick (worker/main.ts) and doing nothing with SOCIAL_ENABLED off:
// the daily selection for each Part A platform (Instagram, Facebook; selectForDay is claimed once per platform and UTC
// day), the poster with the stuck-row recovery on every 5-minute mark, and the metrics once per UTC day (claimed in
// job_runs). Each goes through runJob, so a failure is one failed_jobs row and never stops the tick. Meta credentials
// come from the worker's environment at call time. Plan 5B adds, in the same steps, the video selection for TikTok and
// YouTube, the video poster (approved jobs only) and video metrics. No Next.js imports. Verified by
// tests/unit/social-poster.test.ts and social-video-poster.test.ts.
import type { Db, Queryable } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { socialEnabled } from '@/lib/config';
import { ADAPTERS, type PlatformAdapter } from '@/lib/social/adapters/meta';
import { collectMetrics } from '@/lib/social/metrics';
import { recoverStuck, runPoster } from '@/lib/social/poster';
import { selectForDay } from '@/lib/social/select';
import type { VideoAdapter } from '@/lib/social/adapters/video';
import { collectVideoMetrics, resumeVideoPolls, runVideoPoster, VIDEO_ADAPTERS } from '@/lib/social/video/poster';
import { selectVideos } from '@/lib/social/video/select';
import { VIDEO_PLATFORMS, type Platform, type VideoPlatform } from '@/lib/social/states';
import { runJob } from './run-job';

export type SocialOpts = {
  fetch: typeof fetch;
  adapters?: Partial<Record<Platform, PlatformAdapter>>;
  videoAdapters?: Partial<Record<VideoPlatform, VideoAdapter>>;
  delayMs?: number;
};

async function claimMetrics(db: Queryable, day: string): Promise<boolean> {
  const r = await db.query("INSERT INTO job_runs (job, run_key) VALUES ('social-metrics', $1) ON CONFLICT DO NOTHING RETURNING run_key", [day]);
  return r.rows.length === 1;
}

export async function socialTick(db: Db, now: Date, env: EnvLike, log: string[], o: SocialOpts): Promise<void> {
  if (!socialEnabled()) return;
  const day = now.toISOString().slice(0, 10);
  const deps = { env, fetch: o.fetch, adapters: o.adapters ?? ADAPTERS };
  const videoDeps = { env, fetch: o.fetch, adapters: o.videoAdapters ?? VIDEO_ADAPTERS };
  await runJob(db, 'social-select', async () => {
    for (const platform of Object.keys(deps.adapters) as Platform[]) {
      const r = await selectForDay(db, platform, day, now);
      log.push(`social select ${platform}: ${r.selected} selected, ${r.skipped} skipped`);
    }
    for (const platform of VIDEO_PLATFORMS) {
      const r = await selectVideos(db, platform, day, now);
      log.push(`video select ${platform}: ${r.selected} selected, ${r.skipped} skipped`);
    }
  }, { delayMs: o.delayMs });
  if (now.getUTCMinutes() % 5 === 0) {
    await runJob(db, 'social-post', async () => {
      const stuck = await recoverStuck(db, now);
      const r = await runPoster(db, now, deps);
      const missing = r.noCredentials.length ? `, no credentials: ${r.noCredentials.join(' ')}` : '';
      log.push(`social post: ${r.posted} posted, ${r.deferred} deferred, ${r.failed} failed, ${r.cancelled} cancelled, ${r.flagged + stuck} flagged${missing}`);
      const resumed = await resumeVideoPolls(db, now, videoDeps);
      const v = await runVideoPoster(db, now, videoDeps);
      const vMissing = v.noCredentials.length ? `, no credentials: ${v.noCredentials.join(' ')}` : '';
      log.push(`video post: ${v.posted} posted, ${v.deferred} deferred, ${v.failed} failed, ${v.cancelled} cancelled, ${v.flagged} flagged${vMissing}; resumed ${resumed.posted} posted, ${resumed.failed} failed`);
    }, { delayMs: o.delayMs });
  }
  if (await claimMetrics(db, day).catch(() => false)) {
    await runJob(db, 'social-metrics', async () => {
      const r = await collectMetrics(db, now, deps);
      log.push(`social metrics: ${r.updated} updated, ${r.failed} failed`);
      const v = await collectVideoMetrics(db, now, videoDeps);
      log.push(`video metrics: ${v.updated} updated, ${v.failed} failed`);
    }, { delayMs: o.delayMs });
  }
}
