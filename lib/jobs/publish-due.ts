import type { Db } from '@/lib/db';
import { transition, IllegalTransitionError, ApprovalRequiredError } from '@/lib/items/repo';

const BATCH = 100;

// Publishes scheduled items whose time has come. Safe to run repeatedly and from two places at once: each item is
// published in its own transaction that locks the row, so a second runner finds it already published and skips it.
// An item that can no longer be published without approval (its world went into review mode after it was scheduled)
// goes back to in_review and is reported in `held`; it never stops the rest of the batch.
export async function publishDue(db: Db, now: Date): Promise<{ published: string[]; held: string[] }> {
  const due = await db.query<{ id: string }>(
    "SELECT id FROM items WHERE status = 'scheduled' AND publish_at <= $1::timestamptz ORDER BY publish_at, id LIMIT $2",
    [now.toISOString(), BATCH],
  );
  const published: string[] = [];
  const held: string[] = [];
  for (const { id } of due.rows) {
    try {
      await transition(db, id, 'published', 'system', 'scheduled time reached');
      await db.query("INSERT INTO events (name, meta) VALUES ('item_published', $1::jsonb)", [JSON.stringify({ item: id })]);
      published.push(id);
    } catch (err) {
      if (err instanceof IllegalTransitionError) continue; // another runner got there first
      if (err instanceof ApprovalRequiredError) {
        await transition(db, id, 'in_review', 'system', 'world requires approval before publishing');
        held.push(id);
        continue;
      }
      throw err;
    }
  }
  return { published, held };
}
