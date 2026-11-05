import { notFound } from 'next/navigation';
import ActionForm from '@/components/admin/ActionForm';
import { AttachForm, NewSponsorForm } from '@/components/admin/SponsorForms';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { sponsorshipEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { listSponsorsAdmin } from '@/lib/sponsorship/admin';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string }> };
const RETURN = '/admin/sponsors/';

// Plan 6: create sponsors, attach sponsorships, end them, and see click counts (an upper bound: nothing identifies a
// clicker, so repeat clicks and bots count). Exists only with SPONSORSHIP_ENABLED on.
export default async function AdminSponsorsPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  if (!sponsorshipEnabled()) notFound();
  const { done, error } = await searchParams;
  const { sponsors, sponsorships } = await listSponsorsAdmin(getDb());
  return (
    <>
      <h1>Sponsors</h1>
      <StatusNote done={done} error={error} />
      <section aria-labelledby="sponsorships">
        <h2 id="sponsorships">Sponsorships ({sponsorships.length})</h2>
        <p className="muted">Clicks are an upper bound: nothing about a visitor is kept, so repeat clicks and bots count.</p>
        <ul className="admin-list">
          {sponsorships.map((s) => (
            <li key={s.id}>
              <strong>{s.label}</strong> ({s.kind}) by {s.sponsor} on {s.target}; {s.startsOn ?? 'open'} to {s.endsOn ?? 'open'};{' '}
              <span data-testid={`clicks-${s.id}`}>
                {s.clicks} {s.clicks === 1 ? 'click' : 'clicks'}
              </span>
              ; {s.ended ? 'ended' : 'running'}
              {!s.ended && (
                <ActionForm
                  csrf={admin.csrf}
                  action="sponsorship.end"
                  returnTo={RETURN}
                  label="End now"
                  plain
                  fields={{ id: String(s.id) }}
                  ariaLabel={`End sponsorship: ${s.label}`}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="attach">
        <h2 id="attach">Attach a sponsorship</h2>
        {sponsors.some((s) => s.confirmed) ? <AttachForm csrf={admin.csrf} sponsors={sponsors} /> : <p>Add a sponsor first.</p>}
      </section>
      <section aria-labelledby="new-sponsor">
        <h2 id="new-sponsor">Add a sponsor</h2>
        <NewSponsorForm csrf={admin.csrf} />
      </section>
    </>
  );
}
