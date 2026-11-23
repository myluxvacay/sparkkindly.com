import Link from 'next/link';

// "Report a mistake" on an item page: a plain link to the no-JavaScript form. The form carries the
// item with it, so the visitor never has to say which page they mean.
export default function ReportLink({ world, slug }: { world: string; slug: string }) {
  return (
    <p className="muted">
      <Link rel="nofollow" href={`/report/${encodeURIComponent(world)}/${encodeURIComponent(slug)}/`}>Report a mistake on this page</Link>
    </p>
  );
}
