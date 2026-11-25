import Link from 'next/link';
import type { PublicItem } from '@/lib/items/repo';
import type { World } from '@/lib/public/worlds';
import { readImage } from '@/lib/public/body';
import { bandChipLabel } from '@/lib/age-bands';

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
  // A card for a playable item (quiz/game) is a play-intent entry — the archive shelf above all — so
  // its link carries the play panel's fragment and the visitor lands on the question, not the article
  // header (owner phone report, 17 Nov 2026). Article cards keep the plain URL: reading starts at the top.
  // A printable (22 Nov 2026) is badged as one and links to its sheet page in /printables/, wherever
  // the card appears — search results included — because the sheet view is the printable experience.
  const printable = item.topics.includes('printables');
  const href = printable
    ? `/printables/${item.slug}/`
    : item.kind === 'article'
      ? `/${item.world}/${item.slug}/`
      : `/${item.world}/${item.slug}/#play-panel`;
  const meta = (
    <div className="card-meta">
      <span className={`brand-label ${world?.color ?? 'gold'}`}>{world?.name ?? item.world}</span>
      <span>{printable ? 'Printable' : (KIND_LABEL[item.kind] ?? 'Read')}</span>
      {bandChipLabel(item.ageBands) && <span className="band-chip">{bandChipLabel(item.ageBands)}</span>}
    </div>
  );
  const heading = (
    <Heading>
      <Link href={href}>{item.title}</Link>
    </Heading>
  );
  if (variant === 'text') {
    return (
      <article className="content-card text-card" data-bands={item.ageBands.join(',')}>
        {meta}
        {heading}
        <p>{item.summary}</p>
      </article>
    );
  }
  if (variant === 'strip') {
    const image = readImage(item.image);
    return (
      <article className="content-card strip-card" data-bands={item.ageBands.join(',')}>
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
    <article className="content-card" data-bands={item.ageBands.join(',')}>
      <span className={`card-tile ${world?.color ?? 'gold'}`} aria-hidden="true">{world?.icon ?? '✦'}</span>
      <div className="card-body">
        {meta}
        {heading}
        <p>{item.summary}</p>
      </div>
    </article>
  );
}
