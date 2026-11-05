// What the owner sees in /admin/comments/ (plan 7B): only what needs them. Escalations (with the agent's reason),
// open appeals (with the agent's reason and the author's note), comments hidden by an urgent report in the last 7 days,
// muted reporters (by an opaque report number: no account, email or name), and counts. Comment text appears here only
// for these cases. No account id, email or display name is ever read. No Next.js imports.
// Verified by tests/unit/comments-owner.test.tsx.
import type { Queryable } from '@/lib/db';
import { commentCounts, type CommentCounts } from './counts';

type Entry = { id: string; itemTitle: string; path: string; body: string; at: Date };
export type OwnerQueue = {
  escalations: (Entry & { reason: string | null; status: string })[];
  appeals: (Entry & { reason: string | null; note: string | null; status: string })[];
  urgent: (Entry & { reports: number; status: string; reason: string | null })[];
  muted: { report: string; falseReports: number }[];
  counts: CommentCounts;
};

const BASE = `SELECT c.id, i.title AS "itemTitle", '/' || w.slug || '/' || i.slug || '/' AS path, c.body, c.status,
  c.moderation_reason AS reason`;
const JOINS = 'FROM comments c JOIN items i ON i.id = c.item_id JOIN worlds w ON w.id = i.world_id';

export async function ownerQueue(db: Queryable, now: Date): Promise<OwnerQueue> {
  const escalations = await db.query<OwnerQueue['escalations'][number]>(
    `${BASE}, c.escalated_at AS at ${JOINS} WHERE c.escalated_at IS NOT NULL AND c.status IN ('held', 'hidden')
     ORDER BY c.escalated_at LIMIT 100`,
  );
  const appeals = await db.query<OwnerQueue['appeals'][number]>(
    `${BASE}, a.note, a.created_at AS at ${JOINS} JOIN comment_appeals a ON a.comment_id = c.id
     WHERE a.decided_at IS NULL ORDER BY a.created_at LIMIT 100`,
  );
  const urgent = await db.query<OwnerQueue['urgent'][number]>(
    `${BASE}, count(r.id)::int AS reports, max(r.created_at) AS at ${JOINS} JOIN comment_reports r ON r.comment_id = c.id
     WHERE r.urgent AND r.created_at > $1::timestamptz - interval '7 days' AND c.status <> 'deleted'
     GROUP BY c.id, i.title, w.slug, i.slug, c.body, c.status, c.moderation_reason ORDER BY max(r.created_at) DESC LIMIT 100`,
    [now],
  );
  const muted = await db.query<{ report: string; falseReports: number }>(
    `SELECT (SELECT max(r.id)::text FROM comment_reports r WHERE r.reporter_account_id = t.account_id) AS report,
            t.false_reports AS "falseReports"
     FROM account_trust t WHERE t.reports_muted ORDER BY t.updated_at DESC LIMIT 100`,
  );
  return {
    escalations: escalations.rows,
    appeals: appeals.rows,
    urgent: urgent.rows,
    muted: muted.rows.filter((m) => m.report !== null),
    counts: await commentCounts(db, now),
  };
}
