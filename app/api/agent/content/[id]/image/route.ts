import { getDb } from '@/lib/db';
import { uploadHeroImage } from '@/lib/agents/content-push';
import { MAX_IMAGE_BYTES } from '@/lib/agents/content-push-media';
import { agentRoute, agentLimiter, readCapped } from '@/lib/agents/http';

export const dynamic = 'force-dynamic';

// POST /api/agent/content/<id>/image/?alt=..&credit=..&rights=..
// The raw image bytes (PNG/JPEG/WebP) as the body; the server makes the standard hero set from them.
// Submitter keys only, and only the submitting agent (or a master key) may change the item.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const { id } = await params;
  return agentRoute(
    request,
    async (agent) => {
      const declared = Number(request.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return { status: 413, json: { error: 'body_too_large' } };
      const bytes = await readCapped(request, MAX_IMAGE_BYTES);
      if (!bytes) return { status: 413, json: { error: 'body_too_large' } };
      const url = new URL(request.url);
      return uploadHeroImage(db, agent, id, bytes, {
        alt: url.searchParams.get('alt') ?? undefined,
        credit: url.searchParams.get('credit') ?? undefined,
        rights: url.searchParams.get('rights') ?? undefined,
      });
    },
    { db, limiter: agentLimiter },
  );
}
