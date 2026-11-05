// Hold-everything (spec 4a.6): the moderation agent is the safety net behind instant publishing for level-1 accounts. When
// no enabled moderation-role agent has fetched its queue in the last 48 hours (agents.queue_fetched_at, written only by
// recordQueueFetch on the queue route: authenticating, decisions and refused calls never refresh it), new comments from level-1 accounts are held like a level-0 account's. Exactly 48 hours ago still counts.
// No Next.js imports. Verified by tests/unit/comments-hold.test.ts.
import type { Queryable } from '@/lib/db';

export const HOLD_AFTER_HOURS = 48;

export async function moderationActive(db: Queryable, now: Date): Promise<boolean> {
  const r = await db.query<{ active: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM agents WHERE role = 'moderation' AND enabled
       AND queue_fetched_at >= $1::timestamptz - make_interval(hours => $2)) AS active`,
    [now, HOLD_AFTER_HOURS],
  );
  return r.rows[0].active;
}

// Called by the queue route for a moderation agent.
export async function recordQueueFetch(db: Queryable, agentId: number, now: Date): Promise<void> {
  await db.query('UPDATE agents SET queue_fetched_at = $2 WHERE id = $1', [agentId, now]);
}
