import Link from 'next/link';

export type Crumb = { name: string; href?: string };

// The last crumb is the current page: plain text with aria-current. The separators are decorative.
export default function Breadcrumb({ trail }: { trail: Crumb[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {trail.map((c, i) => {
        const last = i === trail.length - 1;
        return (
          <span key={c.name + i} className="crumb">
            {i > 0 && <span aria-hidden="true">/ </span>}
            {last || !c.href ? <span aria-current={last ? 'page' : undefined}>{c.name}</span> : <Link href={c.href}>{c.name}</Link>}
          </span>
        );
      })}
    </nav>
  );
}
