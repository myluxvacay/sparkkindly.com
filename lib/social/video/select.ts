// The daily video selection (plan 5B): for TikTok or YouTube, eligible published video_script items (videoEligibleWhere:
// never Kids by world, audience or tier) with no distribution on that platform yet, ordered and capped by the same 5A
// rules (orderCandidates, skipReason, the platform's daily cap). Each pick gets a `selected` distribution and a
// `brief_pending` video job in the same transaction; every other candidate a `skipped` row with its reason. Claimed once
// per platform and UTC day in job_runs (the same key as the 5A selection, so the two can never both run for a
// platform). No Next.js imports. Verified by tests/unit/social-video-select.test.ts.
import { socialEnabled } from '@/lib/config';
import type { Db } from '@/lib/db';
import { videoEligibleWhere } from '../eligibility';
import { candidates, claimDay, lastPosts, orderCandidates, platformRow, skipReason, usedToday } from '../select';
import { isVideoPlatform } from '../states';

export async function selectVideos(db: Db, platform: string, day: string, now: Date): Promise<{ selected: number; skipped: number }> {
  const none = { selected: 0, skipped: 0 };
  if (!socialEnabled() || !isVideoPlatform(platform)) return none;
  return db.transaction(async (tx) => {
    const p = await platformRow(tx, platform, true);
    if (!p?.enabled || !(await claimDay(tx, platform, day))) return none;
    const cap = Math.max(0, p.daily_cap - (await usedToday(tx, platform, day)));
    const ordered = orderCandidates(await candidates(tx, platform, now, videoEligibleWhere), await lastPosts(tx, platform));
    for (const c of ordered) {
      const reason = skipReason(c, ordered, cap);
      const d = await tx.query<{ id: string }>(
        `INSERT INTO distributions (item_id, platform, day, status, skip_reason) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (item_id, platform) DO NOTHING RETURNING id`,
        [c.itemId, platform, day, reason ? 'skipped' : 'selected', reason],
      );
      if (!reason && d.rows[0]) {
        await tx.query('INSERT INTO video_jobs (item_id, platform, distribution_id) VALUES ($1, $2, $3)', [c.itemId, platform, d.rows[0].id]);
      }
    }
    const selected = Math.min(cap, ordered.length);
    return { selected, skipped: ordered.length - selected };
  });
}
