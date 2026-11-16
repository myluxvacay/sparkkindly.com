// The public sponsors list for /sponsorship/ (owner request, 15 November 2026): every confirmed sponsor,
// grouped under its category label, at most one per category (createSponsor refuses a second, so the list
// never has to choose). Visibility matches the sponsor lines exactly: with SPONSORSHIP_ENABLED off there is
// no list, and a signed-in viewer who may not see sponsorship (a child profile, anyone under 18, a failed
// lookup) does not see it either; anonymous visitors and adult members do. No Next.js imports.
// Verified by tests/unit/sponsorship-list.test.ts.
import { sponsorshipEnabled } from '@/lib/config';
import type { Db } from '@/lib/db';
import { sponsorViewerForSession, viewerMaySeeSponsorship } from './eligibility';
import { categoryLabel } from './rules';

export type PublicSponsor = { name: string; link: string; category: string; categoryLabel: string };

// Null means "this viewer does not see the list at all" (flag off, or a viewer sponsorship is hidden from);
// an empty array means the list is visible and simply has no sponsors yet.
export async function listPublicSponsors(db: Db, token: string | undefined, now: Date): Promise<PublicSponsor[] | null> {
  if (!sponsorshipEnabled()) {
    return null;
  }
  const viewer = await sponsorViewerForSession(db, token, now);
  if (!viewerMaySeeSponsorship(viewer)) {
    return null;
  }
  const r = await db.query<{ name: string; link: string; category: string }>(
    `SELECT name, link, category FROM sponsors
     WHERE confirmed_at IS NOT NULL AND category IS NOT NULL
     ORDER BY category, name`,
  );
  return r.rows.map((s) => ({ ...s, categoryLabel: categoryLabel(s.category) }));
}
