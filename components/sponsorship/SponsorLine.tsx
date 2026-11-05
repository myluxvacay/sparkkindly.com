import Link from 'next/link';
import type { SponsorLine as Line } from '@/lib/sponsorship/select';

// The one sponsor line under an item's title (plan 6): plain text in the site's typography. The label is an ordinary
// underlined link to our own /go/<id>/ redirect (never the sponsor's address, so the page makes no third-party request),
// followed by the fixed disclosure sentence and a link to the page explaining sponsorship. No image, script or logo.
export default function SponsorLine({ line }: { line: Line }) {
  return (
    <p className="byline sponsor-line">
      <a href={`/go/${line.id}/`} rel="sponsored noopener noreferrer">
        {line.label}
      </a>
      . {line.disclosure} <Link href="/sponsorship/">How sponsorship works</Link>
    </p>
  );
}
