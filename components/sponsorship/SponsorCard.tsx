import Link from 'next/link';
import type { SponsorLine as Line } from '@/lib/sponsorship/select';

// The standalone sponsor card, at the bottom of an article and on a world page (owner decision, 8 November 2026). Same
// rules as the line under the title: the link goes through our own /go/<id>/ redirect (so the page makes no third-party
// request), the fixed disclosure sentence is always shown, and there is no image, script or logo.
export default function SponsorCard({ line }: { line: Line }) {
  return (
    <aside className="sponsor-card" aria-label="Sponsored">
      <p className="eyebrow">{line.kind === 'affiliate' ? 'PARTNER OFFER' : 'SUPPORTED BY'}</p>
      <p className="sponsor-card-link">
        <a href={`/go/${line.id}/`} rel="sponsored noopener noreferrer">
          {line.label}
        </a>
      </p>
      <p className="sponsor-card-note">
        {line.disclosure} <Link href="/sponsorship/">How sponsorship works</Link>
      </p>
    </aside>
  );
}
