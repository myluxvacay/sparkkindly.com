// Unpublishing and social posts (plan 5A): called by transitionTx (lib/items/repo.ts) inside the item's own transaction
// whenever an item moves to `archived`, so every unpublish path is covered. Pending distributions (selected, copy_ready,
// scheduled) are cancelled; posted ones are flagged for the owner to remove by hand, each with one failed_jobs alert
// (the digest); their video jobs (plan 5B) are cancelled with them. Hard deletes only ever remove never-published items, which have no distributions. No Next.js imports.
// Verified by tests/unit/social-cancel.test.ts.
import type { Queryable } from '@/lib/db';
import { alert } from '@/lib/jobs/guards';

export async function cancelForItem(tx: Queryable, itemId: string): Promise<{ cancelled: number; flagged: number }> {
  const c = await tx.query(
    `UPDATE distributions SET status = 'cancelled', version = version + 1, updated_at = now(), last_error = 'item unpublished'
     WHERE item_id = $1 AND status IN ('selected', 'copy_ready', 'scheduled') RETURNING id`,
    [itemId],
  );
  // A row in `posting` may be on the platform a moment from now (5A review L2): flagged like a posted one.
  const f = await tx.query<{ id: string; platform: string }>(
    `UPDATE distributions SET status = 'flagged', version = version + 1, updated_at = now(),
       last_error = 'item unpublished after posting: remove manually from the platform'
     WHERE item_id = $1 AND status IN ('posted', 'posting') RETURNING id, platform`,
    [itemId],
  );
  // Plan 5B: the video jobs of the cancelled rows, and of failed ones (5B review L6), stop too (files purged after 30 days).
  await tx.query(
    `UPDATE video_jobs SET state = 'cancelled', version = version + 1, updated_at = now()
     WHERE item_id = $1 AND state <> 'cancelled'
       AND distribution_id IN (SELECT id FROM distributions WHERE item_id = $1 AND status IN ('cancelled', 'failed'))`,
    [itemId],
  );
  for (const x of f.rows) {
    await alert(tx, 'social-post', `social post ${x.id} on ${x.platform}: its item was unpublished, remove it manually from the platform`);
  }
  return { cancelled: c.rows.length, flagged: f.rows.length };
}
