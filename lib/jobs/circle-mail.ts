// The circle mail job (plan 4D): once per UTC hour the worker (worker/main.ts) runs it through runJob when circles are
// on. It refuses when the worker and database clocks disagree (lib/jobs/guards.ts), takes at most 200 mails and 50
// (circle, kind, period) batches a run (the rest go on the next run), and claims each batch in circle_mail_log with
// INSERT ... ON CONFLICT DO NOTHING before sending, so a rerun or a second worker never mails a period twice. Each send is
// bounded by sendEmail's own timeout. Ruling: a failed send is not retried in that period (the claim stays, since
// retrying the batch would re-mail those who got it); the run writes one failed_jobs alert with the count, never an
// address. No Next.js imports; verified by tests/unit/circle-mail-job.test.ts.
import type { Db, Queryable } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import { linkBase } from '@/lib/admin/sessions';
import { unsubscribeSecret } from '@/lib/accounts/unsubscribe';
import { dailyMailFor, rescoreMailFor, weeklyMailFor, type Cap, type Claim } from '@/lib/circles/mail';
import { alert, clockSkewed, type DbNow } from './guards';

export const CIRCLE_MAIL_CAP: Cap = { mails: 200, circles: 50 };
export type CircleMailResult = { sent: number; skipped: number; failed: number };
type Opts = { env: EnvLike; cap?: Cap; dbNow?: DbNow };

export async function claimCircleMail(db: Queryable, now: Date): Promise<boolean> {
  const r = await db.query(
    "INSERT INTO job_runs (job, run_key) VALUES ('circle-mail', $1) ON CONFLICT DO NOTHING RETURNING run_key",
    [now.toISOString().slice(0, 13)],
  );
  return r.rows.length === 1;
}

async function claim(db: Queryable, c: Claim, now: Date): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO circle_mail_log (circle_id, kind, period, sent_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING RETURNING period`,
    [c.circleId, c.kind, c.period, now.toISOString()],
  );
  return r.rows.length === 1;
}

export async function runCircleMail(
  db: Db,
  now: Date,
  send: (m: EmailMessage) => Promise<unknown>,
  o: Opts,
): Promise<CircleMailResult> {
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (await clockSkewed(db, 'circle-mail', now, o.dbNow)) return result;
  const links = { base: linkBase(o.env), secret: unsubscribeSecret(o.env) };
  const cap = { ...(o.cap ?? CIRCLE_MAIL_CAP) };
  for (const pick of [dailyMailFor, weeklyMailFor, rescoreMailFor]) {
    for (const batch of await pick(db, now, cap, links)) {
      cap.circles--;
      cap.mails -= batch.mails.length;
      if (!(await claim(db, batch.claim, now))) {
        result.skipped += batch.mails.length;
        continue;
      }
      for (const { to, subject, text, headers } of batch.mails) {
        try {
          await send({ to, subject, text, headers });
          result.sent++;
        } catch {
          result.failed++;
        }
      }
    }
  }
  if (result.failed) {
    await alert(db, 'circle-mail', `circle mail: ${result.failed} of ${result.sent + result.failed} sends failed`);
  }
  return result;
}
