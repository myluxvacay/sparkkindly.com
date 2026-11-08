// The one sponsor line an item may carry (plan 6). The item is read here by id, never described by the caller, and must
// pass itemMayCarrySponsorship. Among the active sponsorships targeting the item, one of its topics or its world, the
// item's own wins over a topic's over the world's, then the most recently started. Active means: not ended, today
// (a UTC date) within starts_on..ends_on inclusive and the sponsor's active_from..active_to, and the sponsor carries the
// owner's category confirmation. Nothing with SPONSORSHIP_ENABLED off. The caller decides the viewer first
// (viewerMaySeeSponsorship) so no sponsor data is read for an ineligible viewer. No Next.js imports.
// Verified by tests/unit/sponsorship-select.test.ts.
import { isUuid } from '@/lib/accounts/pin';
import { sponsorshipEnabled } from '@/lib/config';
import type { Queryable } from '@/lib/db';
import { itemMayCarrySponsorship, worldMaySponsor } from './eligibility';
import { disclosureFor, type SponsorshipKind, type TargetType } from './rules';

export type SponsorLine = { id: number; label: string; kind: SponsorshipKind; disclosure: string; sponsorName: string };

// Active on the UTC date in parameter `today`, over `sponsorships s JOIN sponsors sp`.
export const activeWhere = (today: string) =>
  `s.ended_at IS NULL AND sp.confirmed_at IS NOT NULL
  AND (s.starts_on IS NULL OR s.starts_on <= ${today}::date) AND (s.ends_on IS NULL OR s.ends_on >= ${today}::date)
  AND (sp.active_from IS NULL OR sp.active_from <= ${today}::date) AND (sp.active_to IS NULL OR sp.active_to >= ${today}::date)`;

type ItemRow = { audience: string; world_slug: string; world_id: number; risk_tier: string; status: string; topic_ids: number[] };
type LineRow = { id: number; label: string; kind: SponsorshipKind; name: string; target: TargetType };

async function readItem(db: Queryable, itemId: string): Promise<ItemRow | null> {
  const r = await db.query<ItemRow>(
    `SELECT i.audience, w.slug AS world_slug, w.id AS world_id, i.risk_tier, i.status,
            ARRAY(SELECT topic_id FROM item_topics WHERE item_id = i.id) AS topic_ids
     FROM items i JOIN worlds w ON w.id = i.world_id WHERE i.id = $1`,
    [itemId],
  );
  return r.rows[0] ?? null;
}

export async function sponsorFor(db: Queryable, itemId: string, today: string): Promise<SponsorLine | null> {
  if (!sponsorshipEnabled() || !isUuid(itemId)) {
    return null;
  }
  const item = await readItem(db, itemId);
  if (!item || !itemMayCarrySponsorship({ ...item, worldSlug: item.world_slug, riskTier: item.risk_tier })) {
    return null;
  }
  const r = await db.query<LineRow>(
    `SELECT s.id, s.label, s.kind, sp.name,
            CASE WHEN s.item_id IS NOT NULL THEN 'item' WHEN s.topic_id IS NOT NULL THEN 'topic' ELSE 'world' END AS target
     FROM sponsorships s JOIN sponsors sp ON sp.id = s.sponsor_id
     WHERE ${activeWhere('$1')}
       AND (s.item_id = $2 OR s.topic_id = ANY($3::int[]) OR s.world_id = $4)
     ORDER BY CASE WHEN s.item_id IS NOT NULL THEN 0 WHEN s.topic_id IS NOT NULL THEN 1 ELSE 2 END,
              s.starts_on DESC NULLS LAST, s.id DESC
     LIMIT 1`,
    [today, itemId, item.topic_ids, item.world_id],
  );
  const row = r.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    sponsorName: row.name,
    disclosure: disclosureFor(row.kind, row.target, row.name),
  };
}

// The sponsorship attached to a whole world, for the card on that world's page. Only the three sponsorable worlds, only a
// world-targeted sponsorship (an item's or topic's own line stays on its item page), the most recently started wins.
// The caller decides the viewer first, as for sponsorFor.
export async function worldSponsorFor(db: Queryable, worldSlug: string, today: string): Promise<SponsorLine | null> {
  if (!sponsorshipEnabled() || !worldMaySponsor(worldSlug)) {
    return null;
  }
  const r = await db.query<LineRow>(
    `SELECT s.id, s.label, s.kind, sp.name, 'world' AS target
     FROM sponsorships s JOIN sponsors sp ON sp.id = s.sponsor_id JOIN worlds w ON w.id = s.world_id
     WHERE ${activeWhere('$1')} AND w.slug = $2
     ORDER BY s.starts_on DESC NULLS LAST, s.id DESC LIMIT 1`,
    [today, worldSlug],
  );
  const row = r.rows[0];
  return row ? { id: row.id, label: row.label, kind: row.kind, sponsorName: row.name, disclosure: disclosureFor(row.kind, 'world', row.name) } : null;
}
