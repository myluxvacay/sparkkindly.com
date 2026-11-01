import type { Queryable } from '@/lib/db';
import type { Audience, RiskTier } from './repo';

export type Decision = { status: 'draft' | 'in_review' | 'scheduled'; publishAt: Date | null; reason: string };

type DecisionInput = {
  gatesOk: boolean;
  audience: Audience;
  riskTier: RiskTier;
  worldApprovalMode: 'auto' | 'review';
  publishAt: Date | null;
  now: Date;
  slot: Date; // the next free slot for this world, from nextSlot()
};

// The one place that turns "did it pass the checks" into a status. A client never chooses its own status.
// Kids content always waits for the owner, even in an auto world (owner decision, 30 October 2026).
export function decideStatus(i: DecisionInput): Decision {
  if (i.riskTier === 'excluded') return { status: 'draft', publishAt: null, reason: 'excluded topic: never published' };
  if (!i.gatesOk) return { status: 'draft', publishAt: null, reason: 'quality gates failed; see the quality report' };
  if (i.riskTier === 'kids' || i.audience === 'kids') {
    return { status: 'in_review', publishAt: null, reason: 'Kids content waits for owner approval' };
  }
  if (i.worldApprovalMode === 'review') {
    return { status: 'in_review', publishAt: null, reason: 'this world is in review mode' };
  }
  const wanted = i.publishAt && i.publishAt.getTime() > i.now.getTime() ? i.publishAt : i.slot;
  return { status: 'scheduled', publishAt: wanted, reason: 'passed all checks; scheduled automatically' };
}

const SLOT_HOUR_UTC = 6;

// The first 06:00 UTC strictly after "now" or after this world's latest scheduled item, whichever is later.
// ponytail: one item per world per day. If a world's goals ask for more per day, give slots a count per day.
export async function nextSlot(db: Queryable, worldId: number, now: Date): Promise<Date> {
  const r = await db.query<{ latest: Date | null }>(
    "SELECT max(publish_at) AS latest FROM items WHERE world_id = $1 AND status = 'scheduled'",
    [worldId],
  );
  const latest = r.rows[0].latest;
  const base = latest && latest.getTime() > now.getTime() ? latest : now;
  const slot = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), SLOT_HOUR_UTC));
  if (slot.getTime() <= base.getTime()) slot.setUTCDate(slot.getUTCDate() + 1);
  return slot;
}

// Serialises slot choice per world: call inside the transaction that inserts or schedules the item, before nextSlot,
// so two simultaneous submissions cannot both take the same day.
export async function lockWorldSlots(tx: Queryable, worldId: number): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(7263002, $1)', [worldId]);
}
