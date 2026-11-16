import { notFound } from 'next/navigation';
import TrustPage from '@/components/TrustPage';
import { accountSessionToken } from '@/lib/accounts/scope-next';
import { sponsorshipEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { metadata as seo } from '@/lib/seo';
import { listPublicSponsors } from '@/lib/sponsorship/list';

export const dynamic = 'force-dynamic';
// With the flag off the 404 carries no metadata of this page (SEO audit L4).
export async function generateMetadata() {
  return sponsorshipEnabled() ? seo('How sponsorship works', 'How sponsorship works on SparkKindly: what a sponsor line looks like, who never sees one, why sponsors have no say in what we publish, and what we count.', '/sponsorship/') : {};
}

// Plan 6: the disclosure page every sponsor line links to. With the flag off the page does not exist.
// The Our sponsors list (owner request, 15 November 2026) sits under the explainer: every confirmed
// sponsor, one per category, visible to exactly the viewers who may see sponsorship.
export default async function Page() {
  if (!sponsorshipEnabled()) notFound();
  const sponsors = await listPublicSponsors(getDb(), await accountSessionToken(), new Date());
  return (
    <>
      <TrustPage
        crumb="Sponsorship"
        eyebrow="SPONSORSHIP"
        title="How sponsorship works."
        updated="15 November 2026"
        sections={[
          {
            heading: 'What you see',
            paragraphs: [
              'Some pieces aimed at adults carry one short line under the title. It names the sponsor and says, in plain words, what the arrangement is: either the topic, section or piece is supported by that sponsor, or SparkKindly earns a commission if you buy through the link.',
              'There are no banners, pop-ups, sponsor images or advertising scripts. The line is written by our own code in the same type as the rest of the page.',
            ],
          },
          {
            heading: 'Who never sees it',
            paragraphs: [
              'Sponsorship never appears on Kids pieces or on pieces meant for everyone. It is never shown to a child profile or to anyone signed in who is under 18.',
            ],
          },
          {
            heading: 'Sponsors have no say in what we publish',
            paragraphs: [
              'Sponsors never see a piece before it is published and cannot ask for changes. The site owner chooses and approves every sponsor; there is no way for a sponsor to sign itself up.',
              'We do not accept sponsors from gambling, alcohol, tobacco and vaping, weapons, adult content, payday lending, cryptocurrency and get-rich schemes, supplements and weight-loss products, political or religious organisations, or anything marketed to children.',
            ],
          },
          {
            heading: 'What we count, and what we do not',
            paragraphs: [
              'The sponsor link goes through a short redirect on our own site so we can count how many times it is followed. We keep only that number. We do not store who clicked, your address or any identifier, we set no cookie, and the sponsor is not told which page you came from.',
            ],
          },
        ]}
      />
      {sponsors !== null && (
        <div className="container trust-page">
          <div className="prose">
            <section>
              <h2>Our sponsors</h2>
              {sponsors.length ? (
                <ul>
                  {sponsors.map((s) => (
                    <li key={s.name}>
                      <a href={s.link} rel="sponsored noopener noreferrer" target="_blank">
                        {s.name}
                      </a>{' '}
                      <span className="muted">— {s.categoryLabel}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  SparkKindly has no sponsors yet. When a sponsor joins, they are listed here — one per category, chosen and approved by the site
                  owner.
                </p>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
