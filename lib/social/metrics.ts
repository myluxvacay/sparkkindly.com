// Daily social metrics (plan 5A): reach, likes and comments for posts of the last 7 days, read through the platform
// adapter into distributions.metrics. A failure on one post is counted and logged (no token, no response text) and never
// stops the others or blocks posting. Platforms without credentials are skipped. No Next.js imports.
// Verified by tests/unit/social-poster.test.ts.
import type { Queryable } from '@/lib/db';
import { ADAPTERS, hasCredentials } from './adapters/meta';
import type { PosterDeps } from './poster';
import type { Platform } from './states';

const WINDOW_MS = 7 * 24 * 3_600_000;
const PER_RUN = 100;

export async function collectMetrics(db: Queryable, now: Date, deps: PosterDeps): Promise<{ updated: number; failed: number }> {
  const adapters = deps.adapters ?? ADAPTERS;
  const r = await db.query<{ id: string; platform: Platform; external_id: string }>(
    `SELECT id, platform, external_id FROM distributions
     WHERE status = 'posted' AND external_id IS NOT NULL AND posted_at > $1 ORDER BY posted_at DESC LIMIT ${PER_RUN}`,
    [new Date(now.getTime() - WINDOW_MS).toISOString()],
  );
  const out = { updated: 0, failed: 0 };
  for (const d of r.rows) {
    const adapter = adapters[d.platform];
    if (!adapter || !hasCredentials(d.platform, deps.env)) continue;
    try {
      const m = await adapter.metrics({ externalId: d.external_id }, { fetch: deps.fetch, env: deps.env, sleep: deps.sleep });
      await db.query('UPDATE distributions SET metrics = $2::jsonb, metrics_at = $3 WHERE id = $1', [d.id, JSON.stringify(m), now.toISOString()]);
      out.updated++;
    } catch (err) {
      console.error(`social metrics: post ${d.id} on ${d.platform} failed:`, (err as Error)?.message);
      out.failed++;
    }
  }
  return out;
}
