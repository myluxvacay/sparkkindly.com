// The owner's moderation actions (plan 7B), run inside the admin action's transaction (lib/admin/actions.ts writes the
// audit row): resolving an escalated (or urgently reported) comment, and resetting a muted reporter. Lock order as in
// the rest of comments: the author's trust row, then the comment. Emails are returned for the caller to send after the
// commit. No Next.js imports. Verified by tests/unit/comments-owner.test.tsx.
import { linkBase } from '@/lib/admin/sessions';
import { unsubscribeSecret } from '@/lib/accounts/unsubscribe';
import type { Queryable } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import { appealToken } from './appeals';
import { AUTHOR_REASONS, appealOutcomeEmail, rejectionEmail, type ReasonCode } from './rejection-email';
import { dismissReports, upholdReports } from './reports';
import { clearDecision, type Cleared } from './decisions';
import { recordApproval, recordRejection } from './trust';

export type Resolution = { status: 'done'; newStatus: string; mail?: EmailMessage; cleared?: Cleared } | { status: 'not_found' | 'wrong_state' };

type Row = { account_id: string; status: string; body: string; code: string | null; email: string; eligible: boolean; appeal: boolean };

// Only an escalated comment or one with an open urgent report (7B review L3): a comment already rejected or hidden by a
// decision has neither, so it is never removed (and its author emailed) twice. A muted reporter's urgent report leaves
// the comment published, so published counts too then. The state decides, never a stored code.
const ELIGIBLE = `(c.escalated_at IS NOT NULL OR EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = c.id AND r.handled_at IS NULL AND r.urgent))`;

// An open appeal on a comment the owner publishes is closed as overturned, with the usual outcome email (L3).
async function overturnOpenAppeal(tx: Queryable, commentId: string, c: Row, now: Date, env: EnvLike): Promise<EmailMessage | undefined> {
  if (!c.appeal) return undefined;
  await tx.query("UPDATE comment_appeals SET outcome = 'overturn', decided_at = $2 WHERE comment_id = $1 AND decided_at IS NULL", [commentId, now]);
  await tx.query('UPDATE account_trust SET rejected = greatest(rejected - 1, 0), updated_at = now() WHERE account_id = $1', [c.account_id]);
  return appealOutcomeEmail({ to: c.email, body: c.body, outcome: 'overturn', site: linkBase(env) });
}

// publish: shown again (an approval for a held comment; open reports dismissed as false; an open appeal overturned).
// remove: rejected (held) or hidden, trust drops, open reports upheld, and the author is emailed with an appeal link.
export async function resolveEscalation(
  tx: Queryable,
  admin: { email: string },
  commentId: string,
  outcome: 'publish' | 'remove',
  now: Date,
  env: EnvLike,
  code: ReasonCode = 'other',
): Promise<Resolution> {
  await tx.query('SELECT 1 FROM account_trust WHERE account_id = (SELECT account_id FROM comments WHERE id = $1) FOR UPDATE', [commentId]);
  const r = await tx.query<Row>(
    `SELECT c.account_id, c.status, c.body, c.moderation_code AS code, a.email, ${ELIGIBLE} AS eligible,
            EXISTS (SELECT 1 FROM comment_appeals p WHERE p.comment_id = c.id AND p.decided_at IS NULL) AS appeal
     FROM comments c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1 FOR UPDATE OF c`,
    [commentId],
  );
  const c = r.rows[0];
  if (!c) return { status: 'not_found' };
  if (!c.eligible || !['held', 'hidden', 'published'].includes(c.status)) return { status: 'wrong_state' };
  if (outcome === 'publish') {
    await tx.query("UPDATE comments SET status = 'published', escalated_at = NULL, decided_by = $2 WHERE id = $1", [commentId, admin.email]);
    if (c.status === 'held') await recordApproval(tx, c.account_id);
    await dismissReports(tx, commentId, now, 'owner');
    const cleared = (await clearDecision(tx, commentId)) ?? undefined;
    return { status: 'done', newStatus: 'published', mail: await overturnOpenAppeal(tx, commentId, c, now, env), cleared };
  }
  const newStatus = c.status === 'held' ? 'rejected' : 'hidden';
  const reason = AUTHOR_REASONS[code];
  await tx.query('UPDATE comments SET status = $2, escalated_at = NULL, moderation_code = $3, decided_by = $4 WHERE id = $1', [
    commentId,
    newStatus,
    code,
    admin.email,
  ]);
  await upholdReports(tx, commentId, now);
  await recordRejection(tx, c.account_id);
  const site = linkBase(env);
  const token = appealToken(unsubscribeSecret(env), commentId, c.account_id, now);
  const appealUrl = token ? `${site}/comments/appeal/${token}/` : null;
  return { status: 'done', newStatus, mail: rejectionEmail({ to: c.email, body: c.body, reason, site, appealUrl }) };
}

// Unmutes the reporter of one report (the owner never sees who it is) and clears their false-report count.
export async function resetReporter(tx: Queryable, reportId: string): Promise<boolean> {
  if (!/^\d{1,18}$/.test(reportId)) return false;
  const r = await tx.query(
    `UPDATE account_trust SET reports_muted = false, false_reports = 0, updated_at = now()
     WHERE account_id = (SELECT reporter_account_id FROM comment_reports WHERE id = $1::bigint)`,
    [reportId],
  );
  return r.rowCount === 1;
}
