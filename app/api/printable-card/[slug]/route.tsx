import { getDb } from '@/lib/db';
import { getPublicItem } from '@/lib/public/reads';
import { readImage } from '@/lib/public/body';
import { currentScope } from '@/lib/accounts/scope-next';
import { printableCardImage } from '@/lib/printables-card';
import { isPrintable, printableAgeBand, printableCategory } from '@/lib/printables';

export const dynamic = 'force-dynamic';

// The share card for a printable (or for the hub, slug 'hub'). Public and cacheable: it carries
// only the title, the collection name and the sheet art — nothing about any viewer.
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (slug === 'hub') {
    return printableCardImage({
      title: 'Free Printables for Kids',
      kicker: 'COLORING · COUNTING · PAPER AEROPLANES · MAZES',
      artSrc: '/images/printable-garden-helpers.webp',
    });
  }
  const item = await getPublicItem(getDb(), await currentScope(), 'kids', slug);
  if (!item || !isPrintable(item)) return new Response('Not found', { status: 404 });
  const category = printableCategory(item);
  const age = printableAgeBand(item);
  const image = readImage(item.image);
  return printableCardImage({
    title: item.title,
    kicker: [category?.name?.toUpperCase() ?? 'PRINTABLE', age?.label?.toUpperCase()].filter(Boolean).join(' · '),
    artSrc: image.src ?? null,
  });
}
