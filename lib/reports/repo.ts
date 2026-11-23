// Problem-report records for the Report-a-Mistake queue (migration 004, lifecycle in 047):
// plain SQL over problem_reports joined to the item it names. Public reads of reports do not exist —
// a report is never shown publicly; only the admin queue reads these. No Next.js imports.
// Verified by tests/unit/reports-repo.test.ts.
import type { Queryable } from '@/lib/db';

export type ReportStatus = 'pending' | 'fixed' | 'not-a-mistake' | 'duplicate';
export const REPORT_STATUSES: ReportStatus[] = ['pending', 'fixed', 'not-a-mistake', 'duplicate'];

export type ProblemReport = {
  id: string;
  itemId: string;
  itemTitle: string;
  itemSlug: string;
  world: string;
  reason: string;
  message: string;
  status: ReportStatus;
  createdAt: Date;
};

type Row = {
  id: string; item_id: string; title: string; slug: string; world: string;
  reason: string; message: string; status: ReportStatus; created_at: Date;
};

const toReport = (r: Row): ProblemReport => ({
  id: r.id,
  itemId: r.item_id,
  itemTitle: r.title,
  itemSlug: r.slug,
  world: r.world,
  reason: r.reason,
  message: r.message,
  status: r.status,
  createdAt: r.created_at,
});

export async function listReportsByStatus(db: Queryable, status: ReportStatus, limit = 200): Promise<ProblemReport[]> {
  const { rows } = await db.query<Row>(
    `SELECT p.id::text, p.item_id, i.title, i.slug, w.slug AS world, p.reason, p.message, p.status, p.created_at
     FROM problem_reports p JOIN items i ON i.id = p.item_id JOIN worlds w ON w.id = i.world_id
     WHERE p.status = $1 ORDER BY p.created_at ASC LIMIT $2`,
    [status, limit],
  );
  return rows.map(toReport);
}

export async function countReportsByStatus(db: Queryable): Promise<Record<ReportStatus, number>> {
  const { rows } = await db.query<{ status: ReportStatus; n: string }>(
    'SELECT status, COUNT(*)::text AS n FROM problem_reports GROUP BY status',
  );
  const counts: Record<ReportStatus, number> = { pending: 0, fixed: 0, 'not-a-mistake': 0, duplicate: 0 };
  for (const r of rows) counts[r.status] = Number(r.n);
  return counts;
}

// One decision, guarded by the status it may start from (the admin actions name it). Returns false
// when the report is not in that status — a stale page or a second decision, not an error.
export async function setReportStatus(
  db: Queryable,
  id: string,
  from: ReportStatus,
  to: ReportStatus,
): Promise<boolean> {
  const { rowCount } = await db.query('UPDATE problem_reports SET status = $1 WHERE id = $2 AND status = $3', [to, id, from]);
  return (rowCount ?? 0) > 0;
}
