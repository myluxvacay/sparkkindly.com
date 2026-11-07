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
  const signedIn = (await accountSessionToken()) !== undefined;
  // The social share image (plan 5A): JPEG, 1080x1350, social-eligible items only. Meta fetches it without cookies (the
  // public card); a signed-in request is held to its scope, so a child profile never gets a card for an item outside
  // its audiences (final review M2), and that copy is private.
  if (socialEnabled() && new URL(req.url).searchParams.get('format') === 'social') {
    const audiences = signedIn ? (await currentScope()).audiences : undefined;
    const image = await socialShareImage(db, world, slug, new Date(), { client: clientKey(req), audiences });
    if (signedIn) image.headers.set('cache-control', 'private, no-store');
    image.headers.append('vary', 'Cookie');
    return image;
  }
  const [item, w] = await Promise.all([getPublicItem(db, await currentScope(), world, slug), getWorld(db, world)]);
  if (!item || !w) return new Response('Not found', { status: 404 });
  const image = templateImage(item, w);
  // What a signed-in context may see differs per person, so its copy never goes into a shared cache, and the public
  // copy is keyed on the cookie so no cache reuses it across a sign-in.
  if (signedIn) image.headers.set('cache-control', 'private, no-store');
  image.headers.append('vary', 'Cookie');
  return image;
}
