// Report one comment (plan 7B): a <details> form that works without JavaScript. The urgent option is its own labelled
// checkbox in plain words; the reason is a labelled select and the note optional (up to 300 characters).
import { REPORT_REASONS } from '@/lib/comments/reports';

const REASON_TEXT: Record<(typeof REPORT_REASONS)[number], string> = {
  abuse: 'Unkind or abusive',
  personal_info: 'Shares personal information',
  advertising: 'Advertising',
  off_topic: 'Not about this item',
  other: 'Something else',
};

export default function ReportForm({ commentId }: { commentId: string }) {
  return (
    <details className="comment-report">
      <summary>Report</summary>
      <form method="post" action="/comments/report/" className="admin-form">
        <input type="hidden" name="comment" value={commentId} />
        <label htmlFor={`report-reason-${commentId}`}>Why are you reporting this comment?</label>
        <select id={`report-reason-${commentId}`} name="reason" required defaultValue="">
          <option value="" disabled>
            Choose a reason
          </option>
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {REASON_TEXT[r]}
            </option>
          ))}
        </select>
        <label htmlFor={`report-note-${commentId}`}>Anything else we should know? (optional, up to 300 characters)</label>
        <textarea id={`report-note-${commentId}`} name="note" rows={3} maxLength={300} />
        <p>
          <input type="checkbox" id={`report-urgent-${commentId}`} name="urgent" value="on" />{' '}
          <label htmlFor={`report-urgent-${commentId}`}>Urgent: someone may be in danger, or a child can be identified</label>
        </p>
        <button type="submit" className="button">
          Send report
        </button>
      </form>
    </details>
  );
}
