import { getDb } from '@/lib/db';
import { getPublicItem } from '@/lib/public/reads';
import { currentScope } from '@/lib/accounts/scope-next';
import { getVideoId, posterSource } from '@/lib/items/video';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 300_000;

// The preview image for an item's owner-attached video, fetched by OUR server from a fixed YouTube image host so the
// visitor's browser never contacts YouTube before they click play. Only the stored, validated id is used (never a
// client value), only for an item this reader may see, with a short timeout and a size cap; anything else is a 404.
export async function GET(_req: Request, ctx: { params: Promise<{ world: string; slug: string }> }) {
  const { world, slug } = await ctx.params;
  const db = getDb();
  const item = await getPublicItem(db, await currentScope(), world, slug);
  const id = item && item.audience !== 'kids' ? await getVideoId(db, item.id) : null;
  if (!id) return new Response('Not found', { status: 404 });
  try {
    const r = await fetch(posterSource(id), { signal: AbortSignal.timeout(4000), redirect: 'error' });
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !type.startsWith('image/jpeg')) return new Response('Not found', { status: 404 });
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > MAX_BYTES) return new Response('Not found', { status: 404 });
    return new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
