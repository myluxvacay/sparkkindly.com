// The owner's comment moderation queue in /admin/comments/ (plan 7B): escalations, appeals, urgent reports and muted
// reporters, each with its response target from the operating model (spec 4a.6) as text. Only comment text, the
// agent's reason and the author's appeal note are shown; never an email, account id or name. Works without JavaScript.
import ActionForm from '@/components/admin/ActionForm';
import type { OwnerQueue } from '@/lib/comments/owner-queue';

const RETURN = '/admin/comments/';
const when = (d: Date) => new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

type Props = { queue: OwnerQueue; csrf: string };

function Counts({ c }: { c: OwnerQueue['counts'] }) {
  return (
    <ul className="admin-list">
      <li>Held, waiting for the moderation agent: {c.held}</li>
      <li>Published by the agent (24 hours): {c.publishedByAgent}</li>
      <li>Rejected or hidden by the agent (24 hours): {c.rejectedByAgent}</li>
      <li>Escalated to you: {c.escalated}</li>
      <li>Open appeals: {c.appealsOpen}</li>
      <li>Urgent reports (24 hours): {c.urgent24h}</li>
    </ul>
  );
}

function Resolve({ id, csrf, label }: { id: string; csrf: string; label: string }) {
  return (
    <div className="admin-actions">
      <ActionForm csrf={csrf} action="comments.escalation_resolve" returnTo={RETURN} label="Publish" ariaLabel={`Publish: ${label}`} fields={{ comment: id, outcome: 'publish' }} />
      <ActionForm csrf={csrf} action="comments.escalation_resolve" returnTo={RETURN} label="Remove" ariaLabel={`Remove: ${label}`} fields={{ comment: id, outcome: 'remove' }} plain />
    </div>
  );
}

export default function CommentQueue({ queue, csrf }: Props) {
  return (
    <>
      <h2>Moderation</h2>
      <Counts c={queue.counts} />

      <h3>Escalated by the agent</h3>
      <p className="muted">Response target: within 48 hours. Until then the comment stays hidden.</p>
      {queue.escalations.length === 0 && <p>None.</p>}
      <ul className="admin-list">
        {queue.escalations.map((e, i) => (
          <li key={e.id}>
            <p>
              On <a href={e.path}>{e.itemTitle}</a>, {when(e.at)}:
            </p>
            <blockquote>{e.body}</blockquote>
            <p>Agent&apos;s reason: {e.reason ?? '(none)'}</p>
            <Resolve id={e.id} csrf={csrf} label={`escalation ${i + 1}`} />
          </li>
        ))}
      </ul>

      <h3>Appeals</h3>
      <p className="muted">Response target: within 48 hours. The author is emailed the outcome.</p>
      {queue.appeals.length === 0 && <p>None.</p>}
      <ul className="admin-list">
        {queue.appeals.map((a, i) => (
          <li key={a.id}>
            <p>
              On <a href={a.path}>{a.itemTitle}</a>, appealed {when(a.at)}:
            </p>
            <blockquote>{a.body}</blockquote>
            <p>Agent&apos;s reason: {a.reason ?? '(none)'}</p>
            <p>Author&apos;s note: {a.note ?? '(none)'}</p>
            <div className="admin-actions">
              <ActionForm csrf={csrf} action="comments.appeal_overturn" returnTo={RETURN} label="Overturn (publish)" ariaLabel={`Overturn: appeal ${i + 1}`} fields={{ comment: a.id }} />
              <ActionForm csrf={csrf} action="comments.appeal_uphold" returnTo={RETURN} label="Uphold" ariaLabel={`Uphold: appeal ${i + 1}`} fields={{ comment: a.id }} plain />
            </div>
          </li>
        ))}
      </ul>

      <h3>Urgent reports (last 7 days)</h3>
      <p className="muted">Response target: within 24 hours. A comment hidden by an urgent report stays hidden until ruled on.</p>
      {queue.urgent.length === 0 && <p>None.</p>}
      <ul className="admin-list">
        {queue.urgent.map((u, i) => (
          <li key={u.id}>
            <p>
              On <a href={u.path}>{u.itemTitle}</a>: {u.reports} urgent report{u.reports === 1 ? '' : 's'}, latest {when(u.at)}; now {u.status}.
            </p>
            <blockquote>{u.body}</blockquote>
            {(u.status === 'hidden' || u.status === 'held') && <Resolve id={u.id} csrf={csrf} label={`urgent report ${i + 1}`} />}
          </li>
        ))}
      </ul>

      {queue.muted.length > 0 && (
        <>
          <h3>Muted reporters</h3>
          <p className="muted">After three reports the agent judged wrong, a member&apos;s reports count for nothing until you reset them.</p>
          <ul className="admin-list">
            {queue.muted.map((m) => (
              <li key={m.report}>
                Reporter of report {m.report}: {m.falseReports} dismissed reports{' '}
                <ActionForm csrf={csrf} action="comments.report_reset" returnTo={RETURN} label="Reset" ariaLabel={`Reset reporter of report ${m.report}`} fields={{ report: m.report }} plain />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
