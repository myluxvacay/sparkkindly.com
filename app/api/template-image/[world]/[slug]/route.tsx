import { getDb } from '@/lib/db';
import { getPublicItem } from '@/lib/public/reads';
import { accountSessionToken, currentScope } from '@/lib/accounts/scope-next';
import { getWorld } from '@/lib/public/worlds';
import { templateImage } from '@/lib/public/template-image';
import { socialEnabled } from '@/lib/config';
import { socialShareImage } from '@/lib/social/share-image';
import { clientKey } from '@/lib/admin/guard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ world: string; slug: string }> }) {
  const { world, slug } = await ctx.params;
  const db = getDb();
  // The social share image (plan 5A): JPEG, 1080x1350, social-eligible items only, never session-dependent.
  if (socialEnabled() && new URL(req.url).searchParams.get('format') === 'social') {
    return socialShareImage(db, world, slug, new Date(), { client: clientKey(req) });
  }
  const signedIn = (await accountSessionToken()) !== undefined;
  const [item, w] = await Promise.all([getPublicItem(db, await currentScope(), world, slug), getWorld(db, world)]);
  if (!item || !w) return new Response('Not found', { status: 404 });
  const image = templateImage(item, w);
  // What a signed-in context may see differs per person, so its copy never goes into a shared cache, and the public
  // copy is keyed on the cookie so no cache reuses it across a sign-in.
  if (signedIn) image.headers.set('cache-control', 'private, no-store');
  image.headers.append('vary', 'Cookie');
  return image;
}
