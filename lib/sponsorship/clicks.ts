// Click counting (plan 6): one atomic UPDATE adds 1 to click_count and returns the sponsor's stored link, only when the
// flag is on, the viewer may see sponsorship, the sponsorship is active today (UTC) and, for an item sponsorship, the
// item still qualifies. The redirect target is always the stored link of that sponsorship id, re-checked as a safe
// https address; nothing from the request ever becomes the URL. Nothing about the viewer is stored, so the count is an
// upper bound (bots and repeat clicks count). No Next.js imports. Verified by tests/unit/sponsorship-select.test.ts.
import { sponsorshipEnabled } from '@/lib/config';
import type { Queryable } from '@/lib/db';
import { isSafeSourceUrl } from '@/lib/items/gates';
import { ITEM_SPONSORABLE_SQL, viewerMaySeeSponsorship, type SponsorViewer } from './eligibility';
import { activeWhere } from './select';

export async function recordClick(
  db: Queryable,
  sponsorshipId: number,
  today: string,
  viewer: SponsorViewer,
): Promise<{ url: string } | null> {
  if (!sponsorshipEnabled() || !viewerMaySeeSponsorship(viewer) || !Number.isSafeInteger(sponsorshipId) || sponsorshipId < 1) {
    return null;
  }
  const r = await db.query<{ link: string }>(
    `UPDATE sponsorships s SET click_count = s.click_count + 1
     FROM sponsors sp
     WHERE s.id = $1 AND sp.id = s.sponsor_id AND ${activeWhere('$2')}
       AND (s.item_id IS NULL OR EXISTS (SELECT 1 FROM items i JOIN worlds w ON w.id = i.world_id
                                         WHERE i.id = s.item_id AND ${ITEM_SPONSORABLE_SQL}))
     RETURNING sp.link`,
    [sponsorshipId, today],
  );
  const link = r.rows[0]?.link;
  return link && isSafeSourceUrl(link) ? { url: link } : null;
}
