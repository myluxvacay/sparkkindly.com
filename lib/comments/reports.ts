// Comment reports (plan 7B, spec Project 7 "Reporting"). A verified, non-banned account in its adult context that may
// comment (public_comment: 16+; ruling: 13-15 accounts get no report form and are refused, as for comments) reports another member's published comment once, with
// a reason, an optional note (up to 300 characters) and an urgent flag. Each report keeps the weight it carried: level 1
// counts 1, level 0 counts 0.5, a muted reporter 0. Open weight >= 2 hides the comment pending the moderation agent. An
// urgent report alerts the owner at once (counts only) and hides the comment at once only when its weight is 1 (a level-1,
// unmuted reporter); otherwise it counts its normal weight. 10 reports a rolling day per account, of which 3 may be
// urgent: a further urgent report is stored as a normal one, without an alert (the result says urgent: 'limit').
// Lock order (matching 7A and account deletion): reporter account (KEY SHARE), reporter trust row, then the comment row
// FOR UPDATE, so two reports crossing the threshold together hide it exactly once. No Next.js imports.
// Verified by tests/unit/comments-reports.test.ts.
import { requireAdultContext, type AccountContext } from '@/lib/accounts/context';
import { isUuid } from '@/lib/accounts/pin';
import { ageGroupFor, type Consent } from '@/lib/accounts/policy';
import { cleanNote } from '@/lib/circles/reports';
import type { Db, Queryable } from '@/lib/db';
import { commentsAllowedFor } from './repo';
import { mayComment, ticked } from './rules';
import { lockTrust } from './trust';

export const REPORT_REASONS = ['abuse', 'personal_info', 'advertising', 'off_topic', 'other'] as const;
export const REPORT_LIMIT = 10;
export const URGENT_LIMIT = 3;
export const HIDE_WEIGHT = 2;
// Dismissed reports after which a reporter drops a level (once) and their reports weigh 0 until the owner resets it.
export const FALSE_REPORT_LIMIT = 3;

export type ReportInput = { reason: unknown; note?: unknown; urgent?: unknown };
export type ReportRefusal = 'not_allowed' | 'not_found' | 'own' | 'duplicate' | 'invalid' | 'limit';
export type ReportResult =
  | { status: 'reported' | 'hidden'; urgent?: 'limit' }
  | { status: 'refused'; code: ReportRefusal };
export type NotifyOwner = (counts: { urgent24h: number }) => Promise<unknown>;

export const reportWeight = (t: { level: number; reportsMuted: boolean }): number =>
  t.reportsMuted ? 0 : t.level >= 1 ? 1 : 0.5;

// The verified account allowed public_comment (16+) of an adult context, share-locked; null otherwise.
async function reporterOf(tx: Queryable, ctx: AccountContext | null, now: Date): Promise<string | null> {
  const adult = requireAdultContext(ctx);
  if (!adult || !isUuid(adult.account.id)) return null;
  const r = await tx.query<{ dob: string; verified: boolean; consent_state: Consent }>(
    `SELECT to_char(date_of_birth, 'YYYY-MM-DD') AS dob, verified_at IS NOT NULL AS verified, consent_state
     FROM accounts WHERE id = $1 FOR KEY SHARE`,
    [adult.account.id],
  );
  const a = r.rows[0];
  return a?.verified && mayComment(ageGroupFor(a.dob, now), a.consent_state) ? adult.account.id : null;
}

type Checked = { reason: string; note: string | null; urgent: boolean };
type Outcome = ReportResult & { urgent24h?: number };

function checkInput(input: ReportInput): Checked | null {
  const note = cleanNote(input.note);
  if (!REPORT_REASONS.includes(input.reason as (typeof REPORT_REASONS)[number]) || note === false) return null;
  return { reason: input.reason as string, note, urgent: ticked(input.urgent) };
}

async function recentCounts(tx: Queryable, accountId: string, now: Date): Promise<{ all: number; urgent: number }> {
  const r = await tx.query<{ all: number; urgent: number }>(
    `SELECT count(*)::int AS all, (count(*) FILTER (WHERE urgent))::int AS urgent FROM comment_reports
     WHERE reporter_account_id = $1 AND created_at > $2::timestamptz - interval '1 day' AND created_at <= $2`,
    [accountId, now],
  );
  return r.rows[0];
}

// The published comment on a commentable item, locked; or the refusal.
async function lockTarget(tx: Queryable, commentId: string, reporter: string, now: Date): Promise<ReportRefusal | null> {
  const r = await tx.query<{ account_id: string; item_id: string; status: string }>(
    'SELECT account_id, item_id, status FROM comments WHERE id = $1 FOR UPDATE',
    [commentId],
  );
  const c = r.rows[0];
  if (!c || c.status !== 'published' || !(await commentsAllowedFor(tx, c.item_id, now))) return 'not_found';
  if (c.account_id === reporter) return 'own';
  const dup = await tx.query('SELECT 1 FROM comment_reports WHERE comment_id = $1 AND reporter_account_id = $2', [commentId, reporter]);
  return dup.rows.length ? 'duplicate' : null;
}

async function overThreshold(tx: Queryable, commentId: string): Promise<boolean> {
  const r = await tx.query<{ over: boolean }>(
    'SELECT COALESCE(sum(weight), 0) >= $2 AS over FROM comment_reports WHERE comment_id = $1 AND handled_at IS NULL',
    [commentId, HIDE_WEIGHT],
  );
  return r.rows[0].over;
}

async function urgentCount(tx: Queryable, now: Date): Promise<number> {
  const r = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comment_reports WHERE urgent AND created_at > $1::timestamptz - interval '1 day' AND created_at <= $1`,
    [now],
  );
  return r.rows[0].n;
}

async function reportIn(tx: Queryable, ctx: AccountContext | null, commentId: string, input: Checked, now: Date): Promise<Outcome> {
  const refuse = (code: ReportRefusal): Outcome => ({ status: 'refused', code });
  const reporter = await reporterOf(tx, ctx, now);
  if (!reporter) return refuse('not_allowed');
  const trust = await lockTrust(tx, reporter);
  if (trust.banned) return refuse('not_allowed');
  const recent = await recentCounts(tx, reporter, now);
  if (recent.all >= REPORT_LIMIT) return refuse('limit');
  const refused = await lockTarget(tx, commentId, reporter, now);
  if (refused) return refuse(refused);
  const muted = await tx.query<{ m: boolean }>('SELECT reports_muted AS m FROM account_trust WHERE account_id = $1', [reporter]);
  const weight = reportWeight({ level: trust.level, reportsMuted: muted.rows[0].m });
  const urgent = input.urgent && recent.urgent < URGENT_LIMIT;
  await tx.query(
    `INSERT INTO comment_reports (comment_id, reporter_account_id, reason, note, urgent, weight, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [commentId, reporter, input.reason, input.note, urgent, weight, now],
  );
  const hide = (urgent && weight >= 1) || (await overThreshold(tx, commentId));
  if (hide) await tx.query("UPDATE comments SET status = 'hidden' WHERE id = $1", [commentId]);
  return {
    status: hide ? 'hidden' : 'reported',
    ...(input.urgent && !urgent ? { urgent: 'limit' as const } : {}),
    ...(urgent ? { urgent24h: await urgentCount(tx, now) } : {}),
  };
}

export async function reportComment(
  db: Db,
  ctx: AccountContext | null,
  commentId: unknown,
  input: ReportInput,
  now: Date,
  notifyOwner: NotifyOwner,
): Promise<ReportResult> {
  if (!isUuid(commentId)) return { status: 'refused', code: 'not_found' };
  const checked = checkInput(input);
  if (!checked) return { status: 'refused', code: 'invalid' };
  const { urgent24h, ...result } = await db.transaction((tx) => reportIn(tx, ctx, commentId, checked, now));
  if (urgent24h !== undefined) {
    try {
      await notifyOwner({ urgent24h });
    } catch (err) {
      console.error('urgent comment report alert not sent:', (err as Error)?.name);
    }
  }
  return result as ReportResult;
}

// The agent judged a reported comment fine (keep): its open reports are dismissed and each reporter is charged a false
// report. At FALSE_REPORT_LIMIT the reporter drops one level and is muted, once (muting is what makes it once).
export async function dismissReports(tx: Queryable, commentId: string, now = new Date()): Promise<void> {
  const r = await tx.query<{ who: string }>(
    `UPDATE comment_reports SET handled_at = $2, dismissed = true WHERE comment_id = $1 AND handled_at IS NULL
     RETURNING reporter_account_id AS who`,
    [commentId, now],
  );
  const who = r.rows.map((x) => x.who).filter((x) => x !== null);
  if (!who.length) return;
  await tx.query(
    `UPDATE account_trust SET false_reports = false_reports + 1,
       level = CASE WHEN NOT reports_muted AND false_reports + 1 >= $2 THEN greatest(level - 1, 0) ELSE level END,
       reports_muted = reports_muted OR false_reports + 1 >= $2, updated_at = now()
     WHERE account_id = ANY($1::uuid[])`,
    [who, FALSE_REPORT_LIMIT],
  );
}

// The agent upheld the reports (hide or reject): they are handled, nobody is charged.
export async function upholdReports(tx: Queryable, commentId: string, now: Date): Promise<void> {
  await tx.query('UPDATE comment_reports SET handled_at = $2 WHERE comment_id = $1 AND handled_at IS NULL', [commentId, now]);
}
