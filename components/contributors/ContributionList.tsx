import Link from 'next/link';
import type { Mine } from '@/lib/contributors/drafts';
import { EDITABLE_STATES } from '@/lib/contributors/rules';

// Each state as text with the next step (plan 8), so nothing depends on colour or an icon.
const STATE_TEXT: Record<string, string> = {
  draft: 'Draft: only you can see it. Next: submit it for review.',
  submitted: 'Submitted: the automatic checks are running.',
  agent_review: 'Waiting for review: our reviewer checks facts, sources and originality.',
  needs_owner: 'With the site owner: they approve every contributed piece (usually within 7 days).',
  changes_requested: 'Changes requested: revise it using the notes below, then submit it again.',
  approved: 'Approved: it publishes on its scheduled day, and you will get an email with the link.',
  rejected: 'Not published: the reason is below.',
  withdrawn: 'Withdrawn by you.',
};

function Notes({ c }: { c: Mine }) {
  const reasons = c.state === 'draft' ? c.gateReasons : c.state === 'changes_requested' ? c.reviewReasons : [];
  const owner = c.state === 'changes_requested' || c.state === 'rejected' ? c.ownerNotes : null;
  if (!reasons.length && !owner) return null;
  return (
    <ul>
      {reasons.map((r, i) => (
        <li key={i}>{r}</li>
      ))}
      {owner && <li>From the site owner: {owner}</li>}
    </ul>
  );
}

export default function ContributionList({ mine }: { mine: Mine[] }) {
  if (mine.length === 0) return <p>You have no pieces yet.</p>;
  return (
    <ul className="admin-list">
      {mine.map((c) => (
        <li key={c.id}>
          <h3>{c.content.title || '(untitled)'}</h3>
          <p className="muted">
            {c.kind === 'quiz' ? 'Quiz question' : 'Article'} in {c.world}
          </p>
          <p>{STATE_TEXT[c.state] ?? c.state}</p>
          <Notes c={c} />
          <div className="admin-actions">
            {c.itemPath && <Link href={c.itemPath}>Read it on the site</Link>}
            {(EDITABLE_STATES as readonly string[]).includes(c.state) && (
              <Link href={`/me/contribute/?id=${c.id}`} aria-label={`Edit: ${c.content.title || 'untitled piece'}`}>
                Edit
              </Link>
            )}
            {c.state !== 'withdrawn' && (
              <Link href={`/me/contribute/withdraw/?id=${c.id}`} aria-label={`Withdraw: ${c.content.title || 'untitled piece'}`}>
                Withdraw
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
