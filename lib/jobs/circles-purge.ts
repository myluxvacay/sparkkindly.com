// Deletes circles closed more than 30 days ago (spec Project 4: a closed circle's scores are kept for 30 days); member
// rows cascade. Run once per UTC day by the worker (worker/main.ts) with the same guards as the account jobs
// (lib/jobs/guards.ts): a per-run cap with an alert, and a refusal when the clocks disagree. Never touches an open
// circle, and keeps a circle with an unhandled report (moderation evidence) until the owner marks it handled.
// No Next.js imports; verified by tests/unit/circles-purge.test.ts.
import type { Queryable } from '@/lib/db';
import { alert, clockSkewed, type DbNow } from './guards';

const DAY = 86_400_000;
export const CLOSED_KEEP_DAYS = 30;

export async function claimCirclesPurge(db: Queryable, now: Date): Promise<boolean> {
  const r = await db.query(
    "INSERT INTO job_runs (job, run_key) VALUES ('circles-purge', $1) ON CONFLICT DO NOTHING RETURNING run_key",
    [now.toISOString().slice(0, 10)],
  );
  return r.rows.length === 1;
}

export async function purgeClosedCircles(db: Queryable, now: Date, cap = 100, opts: { dbNow?: DbNow } = {}): Promise<number> {
  if (await clockSkewed(db, 'circles-purge', now, opts.dbNow)) {
    return 0;
  }
  const cutoff = new Date(now.getTime() - CLOSED_KEEP_DAYS * DAY).toISOString();
  const due = await db.query<{ id: string }>(
    `SELECT id FROM circles c WHERE status = 'closed' AND closed_at < $1::timestamptz
       AND NOT EXISTS (SELECT 1 FROM circle_reports r WHERE r.circle_id = c.id AND r.handled_at IS NULL)
     ORDER BY closed_at LIMIT $2`,
    [cutoff, cap + 1],
  );
  const r = await db.query("DELETE FROM circles WHERE id = ANY($1::uuid[]) AND status = 'closed'", [
    due.rows.slice(0, cap).map((x) => x.id),
  ]);
  if (due.rows.length > cap) {
    await alert(db, 'circles-purge', `circles purge stopped at the cap: ${r.rowCount ?? 0} circles deleted, more due`);
  }
  return r.rowCount ?? 0;
}
