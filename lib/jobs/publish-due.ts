import type { Db } from '@/lib/db';
import {
  transition,
  transitionTx,
  IllegalTransitionError,
  ApprovalRequiredError,
  NotFoundError,
} from '@/lib/items/repo';

const BATCH = 100;

export type PublishDueResult = { published: string[]; held: string[]; failed: string[] };

// Publishes scheduled items whose time has come, in enabled worlds only (a disabled world's items wait, and publish
// once it is enabled again). Safe to run repeatedly and from two places at once: each item is published, with its
// event row, in one transaction that locks the item, so a second runner finds it already moved and skips it.
// An item that can no longer be published without approval (its world went into review mode after it was scheduled)
// goes back to in_review and is reported in `held`. No single item ever stops the rest of the batch: an unexpected
// failure is reported in `failed` (id and message logged, nothing else) and the item stays scheduled for the next run.
export async function publishDue(db: Db, now: Date): Promise<PublishDueResult> {
  const due = await db.query<{ id: string }>(
    `SELECT i.id FROM items i JOIN worlds w ON w.id = i.world_id AND w.enabled
     WHERE i.status = 'scheduled' AND i.publish_at <= $1::timestamptz ORDER BY i.publish_at, i.id LIMIT $2`,
    [now.toISOString(), BATCH],
  );
  const result: PublishDueResult = { published: [], held: [], failed: [] };
  for (const { id } of due.rows) {
    try {
      await db.transaction(async (tx) => {
        await transitionTx(tx, id, 'published', 'system', 'scheduled time reached');
        await tx.query("INSERT INTO events (name, meta) VALUES ('item_published', $1::jsonb)", [JSON.stringify({ item: id })]);
      });
      result.published.push(id);
    } catch (err) {
      if (err instanceof IllegalTransitionError || err instanceof NotFoundError) continue; // another runner got there first
      if (err instanceof ApprovalRequiredError) {
        if (await holdForReview(db, id)) result.held.push(id);
        continue;
      }
      console.error(`publish-due: item ${id} not published:`, (err as Error).message);
      result.failed.push(id);
    }
  }
  return result;
}

async function holdForReview(db: Db, id: string): Promise<boolean> {
  try {
    await transition(db, id, 'in_review', 'system', 'world requires approval before publishing');
    return true;
  } catch (err) {
    if (!(err instanceof IllegalTransitionError || err instanceof NotFoundError)) {
      console.error(`publish-due: item ${id} could not be sent back to review:`, (err as Error).message);
    }
    return false; // already held by another runner, or it stays scheduled and is retried next run

  }
}
