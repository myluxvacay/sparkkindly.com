// Unpublishing and social posts (plan 5A): called by transitionTx (lib/items/repo.ts) inside the item's own transaction
// whenever an item moves to `archived`, so every unpublish path is covered. Pending distributions (selected, copy_ready,
// scheduled) are cancelled; posted ones are flagged for the owner to remove by hand, each with one failed_jobs alert
// (the digest). Hard deletes only ever remove never-published items, which have no distributions. No Next.js imports.
// Verified by tests/unit/social-cancel.test.ts.
import type { Queryable } from '@/lib/db';
import { alert } from '@/lib/jobs/guards';

export async function cancelForItem(tx: Queryable, itemId: string): Promise<{ cancelled: number; flagged: number }> {
  const c = await tx.query(
    `UPDATE distributions SET status = 'cancelled', version = version + 1, updated_at = now(), last_error = 'item unpublished'
     WHERE item_id = $1 AND status IN ('selected', 'copy_ready', 'scheduled') RETURNING id`,
    [itemId],
  );
  const f = await tx.query<{ id: string; platform: string }>(
    `UPDATE distributions SET status = 'flagged', version = version + 1, updated_at = now(),
       last_error = 'item unpublished after posting: remove manually from the platform'
     WHERE item_id = $1 AND status = 'posted' RETURNING id, platform`,
    [itemId],
  );
  for (const x of f.rows) {
    await alert(tx, 'social-post', `social post ${x.id} on ${x.platform}: its item was unpublished, remove it manually from the platform`);
  }
  return { cancelled: c.rows.length, flagged: f.rows.length };
}
