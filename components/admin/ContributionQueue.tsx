import ActionForm from './ActionForm';
import type { OwnerEntry } from '@/lib/contributors/owner';

const RETURN = '/admin/contributions/';

// One contribution waiting for the owner (plan 8): its full text as plain text (React escapes every value, so markup or
// instructions in it show literally and do nothing), sources, the reviewer's reasons, then approve, request changes or
// reject. Works without JavaScript.
function Text({ e }: { e: OwnerEntry }) {
  if (e.kind === 'quiz') {
    return (
      <>
        <p>
          <strong>Question:</strong> {e.question}
        </p>
        <ol type="a">
          {e.options.map((o, i) => (
            <li key={i}>
              {o}
              {i === e.correct ? ' (marked correct)' : ''}
            </li>
          ))}
        </ol>
        <p>
          <strong>Explanation:</strong> {e.explanation}
        </p>
      </>
    );
  }
  return (
    <>
      {e.sections.map((s, i) => (
        <section key={i}>
          <h4>{s.heading}</h4>
          {s.text.split(/\n\s*\n/).map((p, j) => (
            <p key={j}>{p}</p>
          ))}
        </section>
      ))}
      <p>
        <strong>Takeaway:</strong> {e.takeaway}
      </p>
    </>
  );
}

function Entry({ e, csrf }: { e: OwnerEntry; csrf: string }) {
  return (
    <li>
      <h3>{e.title}</h3>
      <p className="muted">
        {e.kind} in {e.world}, by {e.contributor}, revision {e.revision}, tier {e.tier}
      </p>
      <p>{e.summary}</p>
      <Text e={e} />
      {e.sources.length > 0 && (
        <ul>
          {e.sources.map((s, i) => (
            <li key={i}>
              {s.title}: {s.url}
            </li>
          ))}
        </ul>
      )}
      <p>
        <strong>Reviewer:</strong> {e.reviewReasons.join(' ') || 'no reasons given'}
      </p>
      {e.banned && (
        <p>
          <strong>Comment-banned:</strong> this contributor cannot be approved while the ban stands.
        </p>
      )}
      <div className="admin-actions">
        <ActionForm csrf={csrf} action="contribution.approve" returnTo={RETURN} label="Approve" ariaLabel={`Approve: ${e.title}`} fields={{ id: e.id, version: e.version }} />
      </div>
      <ActionForm csrf={csrf} action="contribution.request_changes" returnTo={RETURN} label="Request changes" ariaLabel={`Request changes: ${e.title}`} fields={{ id: e.id, version: e.version }}>
        <label htmlFor={`notes-${e.id}`}>Notes for the contributor (1 to 500 characters)</label>
        <textarea id={`notes-${e.id}`} name="notes" required maxLength={500} rows={3} />
      </ActionForm>
      <ActionForm csrf={csrf} action="contribution.reject" returnTo={RETURN} label="Reject" ariaLabel={`Reject: ${e.title}`} fields={{ id: e.id, version: e.version }} plain>
        <label htmlFor={`reason-${e.id}`}>Reason for the contributor (1 to 500 characters)</label>
        <textarea id={`reason-${e.id}`} name="reason" required maxLength={500} rows={2} />
      </ActionForm>
    </li>
  );
}

type Props = { queue: OwnerEntry[]; links: { slug: string; displayName: string; link: string }[]; csrf: string };

export default function ContributionQueue({ queue, links, csrf }: Props) {
  return (
    <>
      <h2>Waiting for you</h2>
      <p className="muted">Response target: within 7 days. Nothing contributed is published without your approval.</p>
      {queue.length === 0 ? <p>No contributions are waiting.</p> : (
        <ul className="admin-list">
          {queue.map((e) => (
            <Entry e={e} csrf={csrf} key={e.id} />
          ))}
        </ul>
      )}
      <h2>Proposed links</h2>
      {links.length === 0 ? <p>No links are waiting.</p> : (
        <ul className="admin-list">
          {links.map((l) => (
            <li key={l.slug}>
              {l.displayName}: {l.link}{' '}
              <ActionForm csrf={csrf} action="contribution.link_approve" returnTo={RETURN} label="Approve link" ariaLabel={`Approve link: ${l.displayName}`} fields={{ slug: l.slug, link: l.link }} plain />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
