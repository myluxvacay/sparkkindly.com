import Link from 'next/link';

// "Report a problem" on an item page: a plain link to the no-JavaScript form.
export default function ReportLink({ world, slug }: { world: string; slug: string }) {
  return (
    <p className="muted">
      <Link href={`/report/${encodeURIComponent(world)}/${encodeURIComponent(slug)}/`}>Report a problem with this page</Link>
    </p>
  );
}
