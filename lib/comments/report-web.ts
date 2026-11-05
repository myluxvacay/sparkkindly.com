// POST /comments/report/ (plan 7B) as a plain function, in the style of lib/comments/web.ts: the flags (404 when off),
// then asAdult (Origin, the session's adult context: no session goes to sign-in, a child context gets 403). The
// reporter is the session's account; only comment, reason, note and urgent are read from the form. The redirect goes
// back to the comment's item with an outcome code only. An urgent report alerts the owner through the digest mail path.
// No Next.js imports. Verified by tests/unit/comments-report-web.test.tsx.
import { seeOther } from '@/lib/admin/guard';
import { asAdult } from '@/lib/accounts/children-web';
import { isUuid } from '@/lib/accounts/pin';
import { commentsEnabled } from '@/lib/config';
import type { Db } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import { ownerAlert } from './notices';
import { reportComment, type ReportResult } from './reports';

export type ReportDeps = { db: Db; now: Date; env: EnvLike; send: (m: EmailMessage) => Promise<unknown> };

// Outcome messages for ?c= after a report (merged into COMMENT_MESSAGES).
export const REPORT_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  reported: { text: 'Thank you. Your report has been received.', ok: true },
  report_hidden: { text: 'Thank you. The comment is hidden while it is reviewed.', ok: true },
  report_urgent_limit: {
    text: 'Thank you. Your report has been received; you have sent several urgent reports today, so this one is reviewed as a normal report.',
    ok: true,
  },
  report_own: { text: 'You cannot report your own comment. You can delete it instead.', ok: false },
  report_duplicate: { text: 'You have already reported that comment.', ok: false },
  report_invalid: { text: 'Please choose a reason. A note can be up to 300 characters.', ok: false },
  report_not_found: { text: 'That comment can no longer be reported.', ok: false },
  report_not_allowed: { text: 'Your account cannot send reports.', ok: false },
  report_limit: { text: 'You have sent a lot of reports today. Please try again tomorrow.', ok: false },
};

function codeFor(r: ReportResult): string {
  if (r.status === 'refused') return `report_${r.code}`;
  if (r.status === 'hidden') return 'report_hidden';
  return r.urgent === 'limit' ? 'report_urgent_limit' : 'reported';
}

// The comment's item path, for a visible item; home otherwise.
async function pathOf(db: Db, commentId: string | null): Promise<string> {
  if (!isUuid(commentId)) return '/';
  const r = await db.query<{ w: string; s: string }>(
    `SELECT w.slug AS w, i.slug AS s FROM comments c JOIN items i ON i.id = c.item_id JOIN worlds w ON w.id = i.world_id
     WHERE c.id = $1 AND i.status = 'published' AND w.enabled`,
    [commentId],
  );
  return r.rows[0] ? `/${r.rows[0].w}/${r.rows[0].s}/` : '/';
}

export function reportCommentRequest(request: Request, d: ReportDeps): Promise<Response> {
  if (!commentsEnabled()) return Promise.resolve(new Response('Not found', { status: 404 }));
  return asAdult(request, d, async (ctx, form) => {
    const commentId = form.get('comment');
    const input = { reason: form.get('reason'), note: form.get('note') ?? undefined, urgent: form.get('urgent') ?? undefined };
    const r = await reportComment(d.db, ctx, commentId, input, d.now, ownerAlert(d.env, d.send));
    return seeOther(`${await pathOf(d.db, commentId)}?c=${codeFor(r)}#result`);
  });
}
