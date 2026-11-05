import { notFound } from 'next/navigation';
import TrustPage from '@/components/TrustPage';
import { contributorsEnabled } from '@/lib/config';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';
export const metadata = seo('Contributor terms', 'The terms for writing for SparkKindly.', '/contributors/terms/');

// Plan 8. Draft written by the builder, not by a lawyer; payment is an open owner decision (spec Project 8). With the
// flag off the page does not exist.
export default function Page() {
  if (!contributorsEnabled()) notFound();
  return (
    <TrustPage
      crumb="Contributor terms"
      eyebrow="CONTRIBUTOR TERMS"
      title="Writing for SparkKindly."
      updated="5 November 2026"
      sections={[
        {
          heading: 'Who can contribute',
          paragraphs: [
            'Members aged 16 and over can switch on the contributor role in their account, choose a display name and, if they like, a one-line bio. Contributors aged 16 and 17 appear under their display name only.',
          ],
        },
        {
          heading: 'Your work, your copyright',
          paragraphs: [
            'You keep the copyright in what you write. When you submit a piece you confirm that it is your own work and contains nothing you lack the rights to.',
            'You grant SparkKindly a non-exclusive, perpetual licence to publish your piece, edit it for clarity, translate it and promote it, always with credit to your display name.',
          ],
        },
        {
          heading: 'How a piece is reviewed',
          paragraphs: [
            'Every piece passes our automatic checks (format, duplicates, blocked topics and words, sources that load), then a review by our AI reviewer (facts and sources, tone, originality and a best-effort search for copied text), and then the site owner, who approves every contributed piece personally. You may be asked for changes, and a piece that is not published is given a reason.',
          ],
        },
        {
          heading: 'No payment, and sponsorship',
          paragraphs: [
            'Contributing is unpaid: you are credited, not paid. Sponsorship may appear on pages that carry contributed pieces, under the same rules as the rest of the site.',
          ],
        },
        {
          heading: 'Withdrawing a piece',
          paragraphs: [
            'You can withdraw any of your pieces at any time from your contributions page. A published piece is taken down at once. Deleting your account takes down your published pieces and removes your contributor page.',
          ],
        },
      ]}
    />
  );
}
