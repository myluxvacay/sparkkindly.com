import Link from 'next/link';

// Previous/next links. Renders nothing at all when neither exists, so there is no empty landmark.
export default function Pager({ prev, next, prevLabel, nextLabel }: { prev?: string; next?: string; prevLabel: string; nextLabel: string }) {
  if (!prev && !next) return null;
  return (
    <nav aria-label="Pages" className="pager">
      {prev && <Link rel="prev" href={prev}>{prevLabel}</Link>}
      {next && <Link rel="next" href={next}>{nextLabel}</Link>}
    </nav>
  );
}
