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
import { rejectionEmail } from './rejection-email';
import { dismissReports, upholdReports } from './reports';
import { recordApproval, recordRejection } from './trust';

export type Resolution = { status: 'done'; newStatus: string; mail?: EmailMessage } | { status: 'not_found' | 'wrong_state' };

type Row = { account_id: string; status: string; body: string; reason: string | null; email: string };

// publish: shown again (an approval for a held comment; open reports dismissed as false). remove: rejected (held) or
// hidden, trust drops, open reports upheld, and the author is emailed the reason with an appeal link.
export async function resolveEscalation(
  tx: Queryable,
  admin: { email: string },
  commentId: string,
  outcome: 'publish' | 'remove',
  now: Date,
  env: EnvLike,
): Promise<Resolution> {
  await tx.query('SELECT 1 FROM account_trust WHERE account_id = (SELECT account_id FROM comments WHERE id = $1) FOR UPDATE', [commentId]);
  const r = await tx.query<Row>(
    `SELECT c.account_id, c.status, c.body, c.moderation_reason AS reason, a.email
     FROM comments c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1 FOR UPDATE OF c`,
    [commentId],
  );
  const c = r.rows[0];
  if (!c) return { status: 'not_found' };
  if (c.status !== 'held' && c.status !== 'hidden') return { status: 'wrong_state' };
  if (outcome === 'publish') {
    await tx.query("UPDATE comments SET status = 'published', escalated_at = NULL, decided_by = $2 WHERE id = $1", [commentId, admin.email]);
    if (c.status === 'held') await recordApproval(tx, c.account_id);
    await dismissReports(tx, commentId, now);
    return { status: 'done', newStatus: 'published' };
  }
  const newStatus = c.status === 'held' ? 'rejected' : 'hidden';
  const reason = c.reason ?? 'It does not follow the community guidelines.';
  await tx.query('UPDATE comments SET status = $2, escalated_at = NULL, moderation_reason = $3, decided_by = $4 WHERE id = $1', [
    commentId,
    newStatus,
    reason,
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
