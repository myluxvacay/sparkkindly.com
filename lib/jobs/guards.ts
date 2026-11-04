// Guards shared by the daily jobs that delete accounts (inactivity sweep, consent sweep, unverified purge): an alert row
// the owner sees with the other failed jobs (counts only, never an address), and a refusal when the worker clock and the
// database clock differ by more than 10 minutes (a wrong clock could make every account look due). No Next.js imports;
// verified by tests/unit/account-inactivity.test.ts, account-consent-sweep.test.ts and account-retention.test.ts.
import type { Queryable } from '@/lib/db';

const MAX_SKEW_MS = 10 * 60_000;

// The database clock source; a job takes it as an option only so tests can simulate time.
export type DbNow = () => Promise<Date>;

export async function alert(db: Queryable, job: string, message: string): Promise<void> {
  await db.query("INSERT INTO failed_jobs (job, payload, error, attempts) VALUES ($1, '{}'::jsonb, $2, 1)", [job, message]);
}

// True, after one alert, when the two clocks differ by more than 10 minutes; the caller then does nothing.
export async function clockSkewed(db: Queryable, job: string, now: Date, dbNow?: DbNow): Promise<boolean> {
  const t = dbNow ? await dbNow() : new Date((await db.query<{ t: Date }>('SELECT now() AS t')).rows[0].t);
  if (Math.abs(t.getTime() - now.getTime()) <= MAX_SKEW_MS) {
    return false;
  }
  const label = job.replace(/-/g, ' ');
  await alert(db, job, `${label} refused: the worker clock and the database clock differ by more than 10 minutes`);
  return true;
}
