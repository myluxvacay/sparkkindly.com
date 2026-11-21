import { getDb } from '@/lib/db';
import { parseMediaFileName, pushMediaDir, readMediaFile } from '@/lib/agents/content-push-media';

export const dynamic = 'force-dynamic';

// GET /api/push-media/<item-id>[-480|-960|-1600].webp|.avif
// The hero files the Content Push API stored in the shared media dir. (An API route rather than a
// static path because the files live outside the release and must survive deploys.) The file name is
// an item id plus a variant suffix, validated strictly — and the bytes are served only while the
// owning item is PUBLISHED: a draft's, a rejected item's or a gate-failed Kids item's hero is not
// public just because its file exists, whatever a leaked item id might suggest.
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const parsed = parseMediaFileName(file);
  if (!parsed) return new Response('Not found', { status: 404 });
  const db = getDb();
  const owner = await db.query<{ status: string }>('SELECT status FROM items WHERE id = $1', [parsed.itemId]);
  if (owner.rows[0]?.status !== 'published') return new Response('Not found', { status: 404 });
  const found = await readMediaFile(pushMediaDir(process.env), file);
  if (!found) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(found.bytes), {
    headers: { 'content-type': found.type, 'cache-control': 'public, max-age=3600' },
  });
}
