import { getDb } from '@/lib/db';
import { getPublicItem } from '@/lib/public/reads';
import { anonymousScope } from '@/lib/public/scope';
import { getWorld } from '@/lib/public/worlds';
import { templateImage } from '@/lib/public/template-image';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ world: string; slug: string }> }) {
  const { world, slug } = await ctx.params;
  const db = getDb();
  const [item, w] = await Promise.all([getPublicItem(db, anonymousScope(), world, slug), getWorld(db, world)]);
  if (!item || !w) return new Response('Not found', { status: 404 });
  return templateImage(item, w);
}
