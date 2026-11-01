import Link from 'next/link';
import type { PublicItem } from '@/lib/items/repo';
import type { World } from '@/lib/public/worlds';

const KIND_LABEL: Record<string, string> = { article: 'Read', quiz: 'Quiz', game: 'Game' };

export default function ItemCard({ item, world }: { item: PublicItem; world?: World }) {
  const href = `/${item.world}/${item.slug}/`;
  return (
    <article className="content-card">
      <Link className="image-link" href={href} tabIndex={-1} aria-hidden="true">
        <img src={`/api/template-image/${item.world}/${item.slug}/`} alt="" width={600} height={315} loading="lazy" />
      </Link>
      <div className="card-meta">
        <span className={`brand-label ${world?.color ?? 'gold'}`}>{world?.name ?? item.world}</span>
        <span>{KIND_LABEL[item.kind] ?? 'Read'}</span>
      </div>
      <h3>
        <Link href={href}>{item.title}</Link>
      </h3>
      <p>{item.summary}</p>
    </article>
  );
}
