// Comment moderation counts for the daily digest and /admin/comments/ (plan 7B). Numbers only, never text.
// "By the agent" comes from the audit rows its decisions write (actor agent:<name>), in the last 24 hours.
// No Next.js imports. Verified by tests/unit/comments-owner.test.tsx.
import type { Queryable } from '@/lib/db';

export type CommentCounts = {
  held: number;
  publishedByAgent: number;
  rejectedByAgent: number;
  escalated: number;
  appealsOpen: number;
  urgent24h: number;
};

export async function commentCounts(db: Queryable, now: Date): Promise<CommentCounts> {
  const r = await db.query<CommentCounts>(
    `SELECT
       (SELECT count(*)::int FROM comments WHERE status = 'held' AND escalated_at IS NULL) AS held,
       (SELECT count(*)::int FROM audit_log WHERE actor LIKE 'agent:%' AND action IN ('comment.approve', 'comment.keep')
          AND at > $1::timestamptz - interval '24 hours' AND at <= $1) AS "publishedByAgent",
       (SELECT count(*)::int FROM audit_log WHERE actor LIKE 'agent:%' AND action IN ('comment.reject', 'comment.hide')
          AND at > $1::timestamptz - interval '24 hours' AND at <= $1) AS "rejectedByAgent",
       (SELECT count(*)::int FROM comments WHERE escalated_at IS NOT NULL AND status IN ('held', 'hidden')) AS escalated,
       (SELECT count(*)::int FROM comment_appeals WHERE decided_at IS NULL) AS "appealsOpen",
       (SELECT count(*)::int FROM comment_reports WHERE urgent AND created_at > $1::timestamptz - interval '24 hours'
          AND created_at <= $1) AS "urgent24h"`,
    [now],
  );
  return r.rows[0];
}
