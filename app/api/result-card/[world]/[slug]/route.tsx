import { getDb } from '@/lib/db';
import { getPublicItem } from '@/lib/public/reads';
import { accountSessionToken, currentScope } from '@/lib/accounts/scope-next';
import { getWorld } from '@/lib/public/worlds';
import { resultCardImage } from '@/lib/public/template-image';

export const dynamic = 'force-dynamic';

// The shareable result card for one playable item (teen UI pass, 15 Nov 2026). The card is built only from
// the item's public title and world — it never knows who asked or how they answered — and the item itself is
// loaded in the viewer's scope, so a card exists only for an item the viewer may see.
export async function GET(_req: Request, ctx: { params: Promise<{ world: string; slug: string }> }) {
  const { world, slug } = await ctx.params;
  const db = getDb();
  const signedIn = (await accountSessionToken()) !== undefined;
  const [item, w] = await Promise.all([getPublicItem(db, await currentScope(), world, slug), getWorld(db, world)]);
  if (!item || !w) return new Response('Not found', { status: 404 });
  const image = resultCardImage(item, w);
  if (signedIn) image.headers.set('cache-control', 'private, no-store');
  image.headers.append('vary', 'Cookie');
  return image;
}
