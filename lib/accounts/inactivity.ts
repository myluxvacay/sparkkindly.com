// Daily retention job for idle accounts, run by the worker once per UTC day: an account nobody has signed in to (no
// session seen) and answered with (no item_responses, any profile) for 24 months (730 days; with no such activity the
// clock is verified_at) gets one notice at its own address, and is deleted 30 days after the notice if still inactive,
// rechecked under the account row lock. Signing in clears the notice (consumeAccountLink in sessions.ts). Never touches
// unverified accounts (the 48 hour purge owns them) or consent-pending teens (the consent sweep owns them). Addresses are
// never logged. No Next.js imports; verified by tests/unit/account-inactivity.test.ts.
import type { Db, Queryable } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import { deleteAccountIn } from './delete';

const DAY = 24 * 60 * 60_000;
const IDLE_DAYS = 730;
const GRACE_DAYS = 30;

export type InactivityResult = { noticed: number; deleted: number; failed: number };

// $1 is the activity cutoff (now - 730 days); `a` is the accounts row.
const INACTIVE = `a.verified_at IS NOT NULL AND a.verified_at <= $1::timestamptz AND a.consent_state <> 'pending'
  AND NOT EXISTS (SELECT 1 FROM account_sessions s WHERE s.account_id = a.id AND s.last_seen_at > $1::timestamptz)
  AND NOT EXISTS (SELECT 1 FROM item_responses r WHERE r.account_id = a.id AND r.answered_at > $1::timestamptz)`;

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
      `On ${deletionDate.toISOString().slice(0, 10)} the account and everything in it is deleted: its child profiles, interests and answers.`,
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
    const due = await tx.query('SELECT 1 FROM accounts WHERE id = $1 AND inactivity_notice_at <= $2::timestamptz FOR UPDATE', [
      id,
      before(now, GRACE_DAYS),
    ]);
    if (due.rows.length !== 1) {
      return false;
    }
    const still = await tx.query(`SELECT 1 FROM accounts a WHERE a.id = $2 AND ${INACTIVE}`, [before(now, IDLE_DAYS), id]);
    if (still.rows.length === 1) {
      return deleteAccountIn(tx, id);
    }
    await tx.query('UPDATE accounts SET inactivity_notice_at = NULL WHERE id = $1', [id]);
    return false;
  });
}

export async function runInactivitySweep(
  db: Db,
  now: Date,
  send: (m: EmailMessage) => Promise<unknown>,
  links: { base: string },
): Promise<InactivityResult> {
  const cutoff = before(now, IDLE_DAYS);
  let deleted = 0;
  const due = await db.query<{ id: string }>('SELECT id FROM accounts WHERE inactivity_notice_at <= $1::timestamptz', [
    before(now, GRACE_DAYS),
  ]);
  for (const { id } of due.rows) {
    if (await deleteIfStillInactive(db, id, now)) {
      deleted++;
    }
  }
  let noticed = 0;
  let failed = 0;
  const idle = await db.query<{ id: string; email: string }>(
    `SELECT a.id, a.email FROM accounts a WHERE a.inactivity_notice_at IS NULL AND ${INACTIVE}`,
    [cutoff],
  );
  const m = inactivityEmail(new Date(now.getTime() + GRACE_DAYS * DAY), `${links.base.replace(/\/+$/, '')}/account/sign-in/`);
  // One notice per account, so no accountSendBudget (per-process memory, and the worker is a one-shot process).
  for (const { id, email } of idle.rows) {
    try {
      await send({ to: email, ...m });
      await db.query(
        `UPDATE accounts a SET inactivity_notice_at = $3 WHERE a.id = $2 AND a.inactivity_notice_at IS NULL AND ${INACTIVE}`,
        [cutoff, id, now.toISOString()],
      );
      noticed++;
    } catch {
      // Left unset: tomorrow's sweep retries. The error is dropped on purpose (it can carry the address).
      failed++;
    }
  }
  return { noticed, deleted, failed };
}
