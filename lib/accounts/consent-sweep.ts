// Daily consent housekeeping for 13 to 15 accounts, run by the worker once per UTC day: delete pending accounts 30 days
// after the holder verified, send the parent one reminder at 7 days, and clear the parent address (and its tokens) once
// the holder is no longer 13 to 15. Never touches unverified accounts (the 48 hour purge owns them) or confirmed ones for
// deletion and reminder. Parent addresses are never logged. No Next.js imports; tests/unit/account-consent-sweep.test.ts.
import type { Db, Queryable } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import { issueConsentTokens } from './consent';
import { consentEmail } from './consent-email';
import { deleteAccountIn } from './delete';
import { ageGroupFor } from './policy';

const DAY = 24 * 60 * 60_000;
export type SweepResult = { reminded: number; deleted: number; cleared: number; failed: number };

// True once per UTC day: the first caller records the day in job_runs.
export async function claimConsentSweep(db: Queryable, now: Date): Promise<boolean> {
  const r = await db.query(
    "INSERT INTO job_runs (job, run_key) VALUES ('consent-sweep', $1) ON CONFLICT DO NOTHING RETURNING run_key",
    [now.toISOString().slice(0, 10)],
  );
  return r.rows.length === 1;
}

const ids = async (db: Queryable, sql: string, params: unknown[]) =>
  (await db.query<{ id: string }>(sql, params)).rows.map((r) => r.id);

async function clearOutgrown(db: Db, now: Date): Promise<number> {
  const rows = await db.query<{ id: string; dob: string }>(
    "SELECT id, to_char(date_of_birth, 'YYYY-MM-DD') AS dob FROM accounts WHERE parent_email IS NOT NULL",
  );
  let cleared = 0;
  for (const { id, dob } of rows.rows) {
    if (ageGroupFor(dob, now) === 'teen_13_15') {
      continue;
    }
    await db.transaction(async (tx) => {
      // A pending account that outgrew the consent age no longer waits on anyone: 'none', not a lingering 'pending'.
      await tx.query(
        "UPDATE accounts SET parent_email = NULL, consent_state = CASE WHEN consent_state = 'pending' THEN 'none' ELSE consent_state END WHERE id = $1",
        [id],
      );
      await tx.query('DELETE FROM account_consent_tokens WHERE account_id = $1', [id]);
    });
    cleared++;
  }
  return cleared;
}

// Deletes the account only if, under its row lock, it is still pending, has a parent address and was verified at or
// before the cutoff: a parent who confirms (or an account that changes) after the listing is not deleted.
export async function deleteIfStillPending(db: Db, id: string, cutoffIso: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const still = await tx.query(
      `SELECT 1 FROM accounts WHERE id = $1 AND consent_state = 'pending' AND parent_email IS NOT NULL
         AND verified_at <= $2::timestamptz FOR UPDATE`,
      [id, cutoffIso],
    );
    return still.rows.length === 1 && (await deleteAccountIn(tx, id));
  });
}

export async function runConsentSweep(
  db: Db,
  now: Date,
  send: (m: EmailMessage) => Promise<unknown>,
  links: { base: string },
): Promise<SweepResult> {
  const at = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  const pending = "consent_state = 'pending' AND parent_email IS NOT NULL AND verified_at IS NOT NULL";
  // Clear first: an account that turned 16 is no longer waiting on a parent, so it is neither deleted nor reminded.
  const cleared = await clearOutgrown(db, now);
  let deleted = 0;
  const cutoff = at(30);
  for (const id of await ids(db, `SELECT id FROM accounts WHERE ${pending} AND verified_at <= $1::timestamptz`, [cutoff])) {
    if (await deleteIfStillPending(db, id, cutoff)) {
      deleted++;
    }
  }
  let reminded = 0;
  let failed = 0;
  const due = await db.query<{ id: string; verified_at: Date }>(
    `SELECT id, verified_at FROM accounts WHERE ${pending} AND consent_reminded_at IS NULL AND verified_at <= $1::timestamptz`,
    [at(7)],
  );
  // Reminders are capped at one per account, so they do not go through accountSendBudget (per-process memory, and the
  // worker is a one-shot process).
  for (const { id, verified_at: verifiedAt } of due.rows) {
    try {
      const t = await issueConsentTokens(db, id, now, { revokeOldConfirm: false });
      if (!t) {
        continue;
      }
      const base = links.base.replace(/\/+$/, '');
      const m = consentEmail('reminder', {
        confirmUrl: `${base}/account/consent/?token=${t.confirm}`,
        withdrawUrl: `${base}/account/consent/withdraw/?token=${t.withdraw}`,
        privacyUrl: `${base}/privacy/`,
        deletionDate: new Date(new Date(verifiedAt).getTime() + 30 * DAY),
      });
      await send({ to: t.parentEmail, ...m });
      await db.query('UPDATE accounts SET consent_reminded_at = $2 WHERE id = $1', [id, now.toISOString()]);
      reminded++;
    } catch {
      // Left unset: tomorrow's sweep retries. The error is dropped on purpose (it can carry the parent's address).
      failed++;
    }
  }
  return { reminded, deleted, cleared, failed };
}
