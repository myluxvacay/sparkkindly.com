// The effects of one moderation agent decision on a locked comment (plan 7B), inside the caller's transaction. The
// caller (lib/comments/moderation.ts) has validated the input, locked the author's trust row and the comment, checked
// the decision applies to the comment's state and that the agent saw its current version. No Next.js imports.
// Verified by tests/unit/comments-moderation.test.ts.
import type { Queryable } from '@/lib/db';
import { dismissReports, upholdReports } from './reports';
import { recordApproval, recordRejection } from './trust';

export type Kind = 'held' | 'reported' | 'sample';
export type Decision = 'approve' | 'reject' | 'escalate' | 'keep' | 'hide';

// Which decisions apply to a comment in each queue state.
export const APPLIES: Record<Decision, Kind[]> = {
  approve: ['held', 'sample'],
  reject: ['held', 'reported', 'sample'],
  hide: ['reported', 'sample'],
  keep: ['reported'],
  escalate: ['held', 'reported', 'sample'],
};

export type Locked = { id: string; accountId: string; kind: Kind; status: string };
type Effect = { status: string; mail: boolean; cleared?: Cleared };
export type Cleared = { code: string | null; reason: string | null };

// A comment published again (agent keep, owner Publish, appeal overturn) carries no earlier removal reason, so no stale
// code can block or colour a later decision. Returns what was cleared, for the caller's audit row; null when nothing was.
export async function clearDecision(tx: Queryable, id: string): Promise<Cleared | null> {
  const r = await tx.query<Cleared>(
    `UPDATE comments c SET moderation_code = NULL, moderation_reason = NULL FROM (SELECT moderation_code, moderation_reason FROM comments WHERE id = $1) old
     WHERE c.id = $1 RETURNING old.moderation_code AS code, old.moderation_reason AS reason`,
    [id],
  );
  const old = r.rows[0];
  return old && (old.code !== null || old.reason !== null) ? old : null;
}

const set = (tx: Queryable, id: string, sql: string, params: unknown[]) =>
  tx.query(`UPDATE comments SET ${sql} WHERE id = $1`, [id, ...params]);

// Applies the decision; returns the comment's new status and whether the author is emailed (reject and hide only).
export async function applyDecision(
  tx: Queryable,
  c: Locked,
  d: { decision: Decision; reason: string | null; code?: string | null; actor: string; now: Date },
): Promise<Effect> {
  // A sampled comment counts as reviewed by any decision but keep (which never applies to a sample).
  const reviewed = ', sample_reviewed_at = CASE WHEN sampled_at IS NOT NULL THEN COALESCE(sample_reviewed_at, $3::timestamptz) END';
  switch (d.decision) {
    case 'approve':
      await set(tx, c.id, `status = 'published', decided_by = $2${reviewed}`, [d.actor, d.now]);
      await recordApproval(tx, c.accountId);
      return { status: 'published', mail: false };
    case 'keep':
      // A sampled comment that was reported counts as reviewed too, so it never re-queues as a sample.
      await set(tx, c.id, `status = 'published', decided_by = $2${reviewed}`, [d.actor, d.now]);
      await dismissReports(tx, c.id, d.now, 'agent');
      return { status: 'published', mail: false, cleared: (await clearDecision(tx, c.id)) ?? undefined };
    case 'escalate': {
      const status = c.kind === 'sample' ? 'hidden' : c.status;
      // The note is for the owner only (7B review M1): never moderation_reason, which an author-facing path could read.
      await set(tx, c.id, `status = $4, escalated_at = $3, escalation_note = $5, decided_by = $2${reviewed}`, [d.actor, d.now, status, d.reason]);
      return { status, mail: false };
    }
    default: {
      // reject or hide: a held comment is rejected; a reported or sampled one is hidden.
      const status = c.kind === 'held' ? 'rejected' : 'hidden';
      await set(tx, c.id, `status = $4, moderation_reason = $5, moderation_code = $6, decided_by = $2${reviewed}`, [
        d.actor,
        d.now,
        status,
        d.reason,
        d.code ?? 'other',
      ]);
      await upholdReports(tx, c.id, d.now);
      await recordRejection(tx, c.accountId);
      return { status, mail: true };
    }
  }
}
