// Daily retention job for idle accounts, run by the worker once per UTC day: an account with no activity (sign-in,
// verification, session seen, answer by any profile) for 24 months (730 days) gets one notice at its own address,
// and is deleted 30 days after the notice if still inactive, rechecked under the account row lock. Signing in clears
// the notice (consumeAccountLink in sessions.ts). Never touches unverified accounts (the 48 hour purge owns them) or
// consent-pending teens (the consent sweep owns them). Addresses are never logged. No Next.js imports; verified by
// tests/unit/account-inactivity.test.ts.
// 730 days is slightly under 24 calendar months when the span crosses 29 February (a notice can come one day early);
// the 30-day grace and the sign-in link in the notice cover that.
import type { Db, Queryable } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import { deleteAccountIn } from './delete';

const DAY = 24 * 60 * 60_000;
const IDLE_DAYS = 730;
const GRACE_DAYS = 30;
// Per-run caps against a bug or bad data acting on many accounts at once; over a cap the run stops and alerts.
const NOTICE_CAP = 50;
const DELETE_CAP = 20;
const MAX_SKEW_MS = 10 * 60_000;

export type InactivityResult = { noticed: number; deleted: number; failed: number };

// The one inactivity test used by the listing, the notice and the deletion recheck. Last activity is the greatest of
// the last sign-in, the account's last_seen_at (kept by the session refresh), verified_at and any answer (GREATEST
// skips NULLs). $1 is the cutoff
// (now - 730 days); `a` is the accounts row.
const INACTIVE = `a.verified_at IS NOT NULL AND a.consent_state <> 'pending'
  AND GREATEST(
    a.last_sign_in_at,
    a.last_seen_at,
    a.verified_at,
    (SELECT max(r.answered_at) FROM item_responses r WHERE r.account_id = a.id)
  ) <= $1::timestamptz`;

const before = (now: Date, days: number) => new Date(now.getTime() - days * DAY).toISOString();

// True once per UTC day: the first caller records the day in job_runs.
export async function claimInactivitySweep(db: Queryable, now: Date): Promise<boolean> {
  const r = await db.query(
    "INSERT INTO job_runs (job, run_key) VALUES ('inactivity-sweep', $1) ON CONFLICT DO NOTHING RETURNING run_key",
    [now.toISOString().slice(0, 10)],
  );
  return r.rows.length === 1;
}

export function inactivityEmail(deletionDate: Date, signInUrl: string): { subject: string; text: string } {
  return {
    subject: 'Your SparkKindly account will be deleted unless you sign in',
    text: [
      'Nobody has signed in to your SparkKindly account, or answered anything with it, for two years.',
      '',
      `On ${deletionDate.toISOString().slice(0, 10)} the account and everything in it is deleted: ` +
        'its child profiles, interests and answers.',
      '',
      'To keep the account, sign in before then:',
      signInUrl,
      '',
      'If you no longer want the account, you do not need to do anything.',
    ].join('\n'),
  };
}

// Deletes the account only if its notice is at least 30 days old and, rechecked after taking the row lock (a fresh
// snapshot, so a sign-in or answer committed meanwhile counts), it is still inactive. An account found active again is
// spared and its notice cleared.
export async function deleteIfStillInactive(db: Db, id: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const due = await tx.query(
      'SELECT 1 FROM accounts WHERE id = $1 AND inactivity_notice_at <= $2::timestamptz FOR UPDATE',
      [id, before(now, GRACE_DAYS)],
    );
    if (due.rows.length !== 1) {
      return false;
    }
    const still = await tx.query(`SELECT 1 FROM accounts a WHERE a.id = $2 AND ${INACTIVE}`, [
      before(now, IDLE_DAYS),
      id,
    ]);
    if (still.rows.length === 1) {
      return deleteAccountIn(tx, id);
    }
    await tx.query('UPDATE accounts SET inactivity_notice_at = NULL WHERE id = $1', [id]);
    return false;
  });
}

// Records an alert the owner sees with the other failed jobs (counts only, never an address).
async function alert(db: Queryable, message: string): Promise<void> {
  await db.query(
    "INSERT INTO failed_jobs (job, payload, error, attempts) VALUES ('inactivity-sweep', '{}'::jsonb, $1, 1)",
    [message],
  );
}

const dbClock = async (db: Queryable): Promise<Date> =>
  new Date((await db.query<{ t: Date }>('SELECT now() AS t')).rows[0].t);

async function deleteDue(db: Db, now: Date): Promise<number> {
  const due = await db.query<{ id: string }>(
    'SELECT id FROM accounts WHERE inactivity_notice_at <= $1::timestamptz ORDER BY inactivity_notice_at LIMIT $2',
    [before(now, GRACE_DAYS), DELETE_CAP + 1],
  );
  let deleted = 0;
  for (const { id } of due.rows.slice(0, DELETE_CAP)) {
    if (await deleteIfStillInactive(db, id, now)) {
      deleted++;
    }
  }
  if (due.rows.length > DELETE_CAP) {
    await alert(
      db,
      `inactivity sweep stopped at the deletion cap: ${deleted} deleted of ${DELETE_CAP} checked, more due`,
    );
  }
  return deleted;
}

async function sendNotices(
  db: Db,
  now: Date,
  send: (m: EmailMessage) => Promise<unknown>,
  base: string,
): Promise<{ noticed: number; failed: number }> {
  const cutoff = before(now, IDLE_DAYS);
  const idle = await db.query<{ id: string; email: string }>(
    `SELECT a.id, a.email FROM accounts a WHERE a.inactivity_notice_at IS NULL AND ${INACTIVE}
     ORDER BY a.verified_at LIMIT $2`,
    [cutoff, NOTICE_CAP + 1],
  );
  const m = inactivityEmail(new Date(now.getTime() + GRACE_DAYS * DAY), `${base.replace(/\/+$/, '')}/account/sign-in/`);
  let noticed = 0;
  let failed = 0;
  // One notice per account, so no accountSendBudget (per-process memory, and the worker is a one-shot process).
  for (const { id, email } of idle.rows.slice(0, NOTICE_CAP)) {
    try {
      await send({ to: email, ...m });
      // Counted only when recorded: an account that became active while the mail was sent matches nothing.
      const r = await db.query(
        `UPDATE accounts a SET inactivity_notice_at = $3
         WHERE a.id = $2 AND a.inactivity_notice_at IS NULL AND ${INACTIVE}`,
        [cutoff, id, now.toISOString()],
      );
      noticed += r.rowCount === 1 ? 1 : 0;
    } catch {
      // Left unset: tomorrow's sweep retries. The error is dropped on purpose (it can carry the address).
      failed++;
    }
  }
  if (idle.rows.length > NOTICE_CAP) {
    await alert(
      db,
      `inactivity sweep stopped at the notice cap: ${noticed} sent of ${NOTICE_CAP} tried, more eligible`,
    );
  }
  return { noticed, failed };
}

// Deletions first (a notice sent today is never due today), then notices. Refuses to do anything when its clock and
// the database's differ by more than 10 minutes (a wrong clock could make every account look idle). `dbNow` is the
// database clock source, replaceable only so tests can simulate time.
export async function runInactivitySweep(
  db: Db,
  now: Date,
  send: (m: EmailMessage) => Promise<unknown>,
  links: { base: string },
  opts: { dbNow?: () => Promise<Date> } = {},
): Promise<InactivityResult> {
  const dbNow = await (opts.dbNow ?? (() => dbClock(db)))();
  if (Math.abs(dbNow.getTime() - now.getTime()) > MAX_SKEW_MS) {
    await alert(db, 'inactivity sweep refused: the worker clock and the database clock differ by more than 10 minutes');
    return { noticed: 0, deleted: 0, failed: 0 };
  }
  const deleted = await deleteDue(db, now);
  return { deleted, ...(await sendNotices(db, now, send, links.base)) };
}
