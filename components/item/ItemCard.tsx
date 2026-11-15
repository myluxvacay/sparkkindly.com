import Link from 'next/link';
import type { PublicItem } from '@/lib/items/repo';
import type { World } from '@/lib/public/worlds';
import { readImage } from '@/lib/public/body';

const KIND_LABEL: Record<string, string> = { article: 'Read', quiz: 'Quiz', game: 'Game' };

// Card layouts, assigned per surface (owner picks, Nov 15, 2026) so the audience can
// react to each where it lives:
// - rows (A): world tile + title + summary — homepage latest, article "more like this".
// - strip (C): the item's own hero image as a small thumb + title + summary — world
//   pages and the quiz archive (blog-style lists).
// - text (D): text only, divider rows — topics, search, contributors, saved items.
// The full-width share image no longer renders in listings; it stays in og:image only.
export type CardVariant = 'rows' | 'strip' | 'text';

// headingLevel is 2 when the card sits directly under the page's h1, 3 (default) under an h2.
export default function ItemCard({ item, world, headingLevel = 3, variant = 'rows' }: { item: PublicItem; world?: World; headingLevel?: 2 | 3; variant?: CardVariant }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const href = `/${item.world}/${item.slug}/`;
  const meta = (
    <div className="card-meta">
      <span className={`brand-label ${world?.color ?? 'gold'}`}>{world?.name ?? item.world}</span>
      <span>{KIND_LABEL[item.kind] ?? 'Read'}</span>
    </div>
  );
  const heading = (
    <Heading>
      <Link href={href}>{item.title}</Link>
    </Heading>
  );
  if (variant === 'text') {
    return (
      <article className="content-card text-card">
        {meta}
        {heading}
        <p>{item.summary}</p>
      </article>
    );
  }
  if (variant === 'strip') {
    const image = readImage(item.image);
    return (
      <article className="content-card strip-card">
        {image.src ? (
          <Link className="strip-thumb" href={href} tabIndex={-1} aria-hidden="true">
            <img src={image.src} alt="" width={208} height={156} loading="lazy" />
          </Link>
        ) : (
          <span className={`card-tile ${world?.color ?? 'gold'}`} aria-hidden="true">{world?.icon ?? '✦'}</span>
        )}
        <div className="card-body">
          {meta}
          {heading}
          <p>{item.summary}</p>
        </div>
      </article>
    );
  }
  return (
    <article className="content-card">
      <span className={`card-tile ${world?.color ?? 'gold'}`} aria-hidden="true">{world?.icon ?? '✦'}</span>
      <div className="card-body">
        {meta}
        {heading}
        <p>{item.summary}</p>
      </div>
    </article>
  );
}
