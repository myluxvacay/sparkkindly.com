// Which items may ever go to social media (plan 5A): published, a kind the site renders (article, quiz, game; never a
// video script, which is Part B), and never Kids by world, audience or risk tier. Checked at selection, at copy
// submission and again at post time, always on the item as read from the database. Fails closed. No Next.js imports.
// Verified by tests/unit/social-rules.test.ts and social-select.test.ts.
import type { Queryable } from '@/lib/db';

export type SocialItem = { worldSlug: string; audience: string; riskTier: string; status: string; kind: string };

const KINDS = ['article', 'quiz', 'game'];

export const isEligibleForSocial = (i: SocialItem): boolean =>
  i?.status === 'published' &&
  KINDS.includes(i.kind) &&
  typeof i.worldSlug === 'string' &&
  i.worldSlug !== 'kids' &&
  i.audience !== 'kids' &&
  typeof i.riskTier === 'string' &&
  i.riskTier !== 'kids' &&
  (i.audience === 'all' || i.audience === 'adults');

// The same rule in SQL over `items i JOIN worlds w`, plus what the public pages require (due, enabled world, English),
// so a link never points at a page that would 404. `now` names the parameter holding the clock.
export const socialEligibleWhere = (now: string) =>
  `i.status = 'published' AND i.published_at <= ${now} AND w.enabled AND i.locale = 'en'
   AND i.kind IN ('article', 'quiz', 'game') AND w.slug <> 'kids' AND i.audience IN ('all', 'adults') AND i.risk_tier <> 'kids'`;

export type EligibleItem = { id: string; world: string; slug: string; kind: string; title: string; summary: string; body: unknown };

// The item by id, only while it is eligible now; null otherwise (unknown, Kids, unpublished, disabled world).
export async function eligibleItem(db: Queryable, itemId: string, now: Date): Promise<EligibleItem | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)) return null;
  const r = await db.query<EligibleItem>(
    `SELECT i.id, w.slug AS world, i.slug, i.kind, i.title, i.summary, i.body
     FROM items i JOIN worlds w ON w.id = i.world_id WHERE i.id = $1 AND ${socialEligibleWhere('$2')}`,
    [itemId, now.toISOString()],
  );
  return r.rows[0] ?? null;
}
