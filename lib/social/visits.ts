// Private counting of visits that arrive from a social post (plan 5A): the item page passes its `utm_source`; when it is
// exactly one of the platform names, one aggregate (day, platform, item) counter goes up. No cookie, IP or identifier
// is read or stored, nothing on the page changes, and with SOCIAL_ENABLED off the database is not touched. Best effort:
// an error is logged and never reaches the page. No Next.js imports. Verified by tests/unit/social-visits.test.ts.
import { socialEnabled } from '@/lib/config';
import type { Queryable } from '@/lib/db';
import { isPlatform } from './states';

export async function recordSocialVisit(db: Queryable, itemId: string, utmSource: unknown, now: Date): Promise<void> {
  if (!socialEnabled() || !isPlatform(utmSource)) return;
  try {
    await db.query(
      `INSERT INTO social_visits (day, platform, item_id, visits) VALUES ($1, $2, $3, 1)
       ON CONFLICT (day, platform, item_id) DO UPDATE SET visits = social_visits.visits + 1`,
      [now.toISOString().slice(0, 10), utmSource, itemId],
    );
  } catch (err) {
    console.error('social visit not counted:', (err as Error)?.name);
  }
}
