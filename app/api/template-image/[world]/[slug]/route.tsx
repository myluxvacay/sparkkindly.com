import { getDb } from '@/lib/db';
import { getPublicItem } from '@/lib/public/reads';
import { accountSessionToken, currentScope } from '@/lib/accounts/scope-next';
import { getWorld } from '@/lib/public/worlds';
import { templateImage } from '@/lib/public/template-image';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ world: string; slug: string }> }) {
  const { world, slug } = await ctx.params;
  const db = getDb();
  const signedIn = (await accountSessionToken()) !== undefined;
  const [item, w] = await Promise.all([getPublicItem(db, await currentScope(), world, slug), getWorld(db, world)]);
  if (!item || !w) return new Response('Not found', { status: 404 });
  const image = templateImage(item, w);
  // What a signed-in context may see differs per person, so its copy never goes into a shared cache.
  if (signedIn) image.headers.set('cache-control', 'private, no-store');
  return image;
}
