// The distribution state machine (plan 5A). Each event has one target and the statuses it may start from; every move
// is one conditional UPDATE (`moveDistribution`), so two callers racing on a row never both win. A posted row is never
// retried or re-scheduled (the platform has it); flagged waits for the owner, who may only cancel it. No Next.js imports.
// Verified by tests/unit/social-rules.test.ts and the poster, cancel and promotion tests.
import type { Queryable } from '@/lib/db';

export const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const isPlatform = (v: unknown): v is Platform => typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v);

export const STATUSES = [
  'selected', 'skipped', 'copy_ready', 'scheduled', 'posting', 'posted', 'failed', 'cancelled', 'flagged',
] as const;
export type DistStatus = (typeof STATUSES)[number];

export const EVENTS = {
  copy: { from: ['selected'], to: 'copy_ready' }, // the promoter's validated copy is stored
  schedule: { from: ['copy_ready'], to: 'scheduled' },
  claim: { from: ['scheduled'], to: 'posting' }, // the poster takes the row
  posted: { from: ['posting'], to: 'posted' },
  defer: { from: ['posting'], to: 'scheduled' }, // a transient failure, tried again later
  fail: { from: ['posting'], to: 'failed' },
  flag: { from: ['posting', 'posted'], to: 'flagged' }, // stuck mid-post, or unpublished after posting
  // posting: the poster's post-time re-check; flagged: the owner checked the platform and the post is not there.
  cancel: { from: ['selected', 'copy_ready', 'scheduled', 'posting', 'failed', 'flagged'], to: 'cancelled' },
  retry: { from: ['failed'], to: 'scheduled' }, // the owner's retry
  pick: { from: ['skipped', 'cancelled'], to: 'selected' }, // the owner's hand-pick
} as const satisfies Record<string, { from: readonly DistStatus[]; to: DistStatus }>;
export type DistEvent = keyof typeof EVENTS;

export function nextStatus(status: DistStatus, event: DistEvent): DistStatus | null {
  const e = Object.hasOwn(EVENTS, event) ? EVENTS[event] : undefined;
  return e && (e.from as readonly string[]).includes(status) ? e.to : null;
}

// Moves one row by an event, atomically: only from the event's statuses (and the given version, when given), bumping
// the version. `set` adds column assignments; its values are parameters, its keys come from the calling code only.
export async function moveDistribution(
  db: Queryable,
  id: number,
  event: DistEvent,
  o: { version?: number; set?: Record<string, unknown> } = {},
): Promise<boolean> {
  const e = EVENTS[event];
  const params: unknown[] = [id, e.to, [...e.from]];
  const sets = Object.entries(o.set ?? {}).map(([col, v]) => {
    if (!/^[a-z_]+$/.test(col)) throw new Error('bad column');
    return `${col} = $${params.push(v)}`;
  });
  const versionCheck = o.version === undefined ? '' : ` AND version = $${params.push(o.version)}`;
  const r = await db.query(
    `UPDATE distributions SET status = $2, version = version + 1, updated_at = now()${sets.map((s) => `, ${s}`).join('')}
     WHERE id = $1 AND status = ANY($3::text[])${versionCheck} RETURNING id`,
    params,
  );
  return r.rows.length === 1;
}
