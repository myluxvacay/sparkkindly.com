import Link from 'next/link';
import type { PublicItem } from '@/lib/items/repo';
import type { World } from '@/lib/public/worlds';

const KIND_LABEL: Record<string, string> = { article: 'Read', quiz: 'Quiz', game: 'Game' };

// headingLevel is 2 when the card sits directly under the page's h1, 3 (default) under an h2.
// Compact row card: a small world tile instead of the full-width share image — the share
// image (1200x630, mostly empty background) stays in og:image for social posts only, so a
// new item no longer takes half the screen in a listing.
export default function ItemCard({ item, world, headingLevel = 3 }: { item: PublicItem; world?: World; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const href = `/${item.world}/${item.slug}/`;
  return (
    <article className="content-card">
      <span className={`card-tile ${world?.color ?? 'gold'}`} aria-hidden="true">{world?.icon ?? '✦'}</span>
      <div className="card-body">
        <div className="card-meta">
          <span className={`brand-label ${world?.color ?? 'gold'}`}>{world?.name ?? item.world}</span>
          <span>{KIND_LABEL[item.kind] ?? 'Read'}</span>
        </div>
        <Heading>
          <Link href={href}>{item.title}</Link>
        </Heading>
        <p>{item.summary}</p>
      </div>
    </article>
  );
}
