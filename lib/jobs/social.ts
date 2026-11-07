// The social jobs (plan 5A), called by every worker tick (worker/main.ts) and doing nothing with SOCIAL_ENABLED off:
// the daily selection for each Part A platform (Instagram, Facebook; selectForDay is claimed once per platform and UTC
// day), the poster with the stuck-row recovery once per UTC 5-minute bucket and the metrics once per UTC day (both
// claimed in job_runs). Each goes through runJob, so a failure is one failed_jobs row and never stops the tick. Meta credentials
// come from the worker's environment at call time. Video (TikTok, YouTube) runs in its own tick and systemd timer
// (lib/jobs/video.ts, 5B review M4), never here. No Next.js imports. Verified by tests/unit/social-poster.test.ts and
// social-video-poster.test.ts.
import type { Db, Queryable } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { socialEnabled } from '@/lib/config';
import { ADAPTERS, type PlatformAdapter } from '@/lib/social/adapters/meta';
import { collectMetrics } from '@/lib/social/metrics';
import { recoverStuck, runPoster } from '@/lib/social/poster';
import { selectForDay } from '@/lib/social/select';
import type { Platform } from '@/lib/social/states';
import { runJob } from './run-job';

export type SocialOpts = {
  fetch: typeof fetch;
  adapters?: Partial<Record<Platform, PlatformAdapter>>;
  delayMs?: number;
};

async function claim(db: Queryable, job: string, key: string): Promise<boolean> {
  const r = await db.query('INSERT INTO job_runs (job, run_key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING run_key', [job, key]);
  return r.rows.length === 1;
}

// The UTC 5-minute bucket a tick falls in, e.g. '2026-11-05T12:05' (final review L5): the poster runs on the first tick
// of each bucket, so a timer that drifts past the :x0/:x5 minute still posts in that bucket.
export function postBucket(now: Date): string {
  return new Date(Math.floor(now.getTime() / 300_000) * 300_000).toISOString().slice(0, 16);
}

export async function socialTick(db: Db, now: Date, env: EnvLike, log: string[], o: SocialOpts): Promise<void> {
  if (!socialEnabled()) return;
  const day = now.toISOString().slice(0, 10);
  const deps = { env, fetch: o.fetch, adapters: o.adapters ?? ADAPTERS };
  await runJob(db, 'social-select', async () => {
    for (const platform of Object.keys(deps.adapters) as Platform[]) {
      const r = await selectForDay(db, platform, day, now);
      log.push(`social select ${platform}: ${r.selected} selected, ${r.skipped} skipped`);
    }
  }, { delayMs: o.delayMs });
  if (await claim(db, 'social-post', postBucket(now)).catch(() => false)) {
    await runJob(db, 'social-post', async () => {
      // 288 bucket rows a day: keep only the last day's.
      await db.query("DELETE FROM job_runs WHERE job = 'social-post' AND run_key < $1", [postBucket(new Date(now.getTime() - 86_400_000))]);
      const stuck = await recoverStuck(db, now);
      const r = await runPoster(db, now, deps);
      const missing = r.noCredentials.length ? `, no credentials: ${r.noCredentials.join(' ')}` : '';
      log.push(`social post: ${r.posted} posted, ${r.deferred} deferred, ${r.failed} failed, ${r.cancelled} cancelled, ${r.flagged + stuck} flagged${missing}`);
    }, { delayMs: o.delayMs });
  }
  if (await claim(db, 'social-metrics', day).catch(() => false)) {
    await runJob(db, 'social-metrics', async () => {
      const r = await collectMetrics(db, now, deps);
      log.push(`social metrics: ${r.updated} updated, ${r.failed} failed`);
    }, { delayMs: o.delayMs });
  }
}
