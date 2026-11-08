// Click counting (plan 6): one atomic UPDATE adds 1 to click_count and returns the sponsor's stored link, only when the
// flag is on, the viewer may see sponsorship, the sponsorship is active today (UTC) and, for an item sponsorship, the
// item still qualifies. The stored link is re-checked as a safe https address with no control character BEFORE the
// count (plan 6 review: a refused link never counts), and the redirect target is its ASCII form (punycode host,
// percent-encoded path), so a link stored before normalisation can never make the Location header throw. Nothing from
// the request ever becomes the URL. Nothing about the viewer is stored, so the count is an upper bound (bots and repeat
// clicks count). No Next.js imports. Verified by tests/unit/sponsorship-select.test.ts.
import { sponsorshipEnabled } from '@/lib/config';
import type { Queryable } from '@/lib/db';
import { isSafeSourceUrl } from '@/lib/items/gates';
import { ITEM_SPONSORABLE_SQL, viewerMaySeeSponsorship, type SponsorViewer } from './eligibility';
import { activeWhere } from './select';

const safeTarget = (link: string | undefined): string | null =>
  link && !/\p{Cc}/u.test(link) && isSafeSourceUrl(link) ? new URL(link).href : null;

export async function recordClick(
  db: Queryable,
  sponsorshipId: number,
  today: string,
  viewer: SponsorViewer,
): Promise<{ url: string } | null> {
  if (!sponsorshipEnabled() || !viewerMaySeeSponsorship(viewer) || !Number.isSafeInteger(sponsorshipId) || sponsorshipId < 1) {
    return null;
  }
  const stored = await db.query<{ link: string }>(
    'SELECT sp.link FROM sponsorships s JOIN sponsors sp ON sp.id = s.sponsor_id WHERE s.id = $1',
    [sponsorshipId],
  );
  if (!safeTarget(stored.rows[0]?.link)) {
    return null;
  }
  const r = await db.query<{ link: string }>(
    `UPDATE sponsorships s SET click_count = s.click_count + 1
     FROM sponsors sp
     WHERE s.id = $1 AND sp.id = s.sponsor_id AND ${activeWhere('$2')} AND sp.link = $3
       AND (s.item_id IS NULL OR EXISTS (SELECT 1 FROM items i JOIN worlds w ON w.id = i.world_id
                                         WHERE i.id = s.item_id AND ${ITEM_SPONSORABLE_SQL}))
       AND (s.world_id IS NULL OR s.world_id IN (SELECT id FROM worlds WHERE slug IN ('save', 'grow', 'discover')))
     RETURNING sp.link`,
    [sponsorshipId, today, stored.rows[0].link],
  );
  const url = safeTarget(r.rows[0]?.link);
  return url ? { url } : null;
}
