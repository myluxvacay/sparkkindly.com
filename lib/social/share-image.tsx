// The branded share image for social posts (plan 5A): 1080x1350 (Instagram's 4:5 portrait), title, world colour and
// name, the SparkKindly wordmark; no personal data, no faces, no user content. Rendered by next/og (PNG) and converted to
// JPEG with sharp (already in the tree; Instagram accepts only JPEG). Served only for an item eligible for social
// media, read by world and slug; a signed-in caller's audiences narrow it further (the route sets those copies private).
// Verified by tests/unit/social-share-image.test.ts and tests/unit/social-share-image-route.test.ts.
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { socialEnabled } from '@/lib/config';
import type { Queryable } from '@/lib/db';
import { CREAM, INK, PLUM, plainTitle, worldHex, wrapTitle } from '@/lib/public/palette';
import { createLimiter } from '@/lib/agents/rate-limit';
import { clientPrefix } from '@/lib/admin/guard';
import { socialEligibleWhere } from './eligibility';

const SLUG = /^[a-z0-9-]{1,80}$/;

// 5A review L6: a rendered card is kept by its content (an edited title or colour renders anew), and rendering is
// rate-limited per network; eligibility is still read on every request, so an unpublished item is 404 at once.
// ponytail: an in-process LRU of 50 JPEGs (about 10 MB); a shared cache only if the app ever runs as several instances.
const CACHE_SIZE = 50;
const cache = new Map<string, Buffer>();
const shared = globalThis as unknown as { __sparkShareImageLimiter?: ReturnType<typeof createLimiter> };
const renderLimiter = (shared.__sparkShareImageLimiter ??= createLimiter({ perMinute: 20 }));
// audiences: the viewer's scope when the request carried an account session (final review M2); omitted = public.
type Opts = { client?: string; limiter?: (key: string) => boolean; audiences?: readonly string[] };

function remember(key: string, jpeg: Buffer): void {
  cache.delete(key);
  cache.set(key, jpeg);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}
const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });

type Card = { title: string; world_name: string; world_color: string | null };

function card(c: Card): ImageResponse {
  const accent = worldHex(c.world_color ?? '');
  const lines = wrapTitle(plainTitle(c.title), 22, 6);
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: CREAM,
          padding: 88,
          borderTop: `32px solid ${accent}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 52, color: PLUM }}>SparkKindly</div>
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, color: INK, background: accent, padding: '12px 32px', borderRadius: 48 }}>
            {c.world_name}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 84, lineHeight: 1.15, color: PLUM }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'flex' }}>
              {l}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', fontSize: 36, color: INK }}>sparkkindly.com</div>
      </div>
    ),
    { width: 1080, height: 1350 },
  );
}

export async function socialShareImage(db: Queryable, world: string, slug: string, now: Date, o: Opts = {}): Promise<Response> {
  if (!socialEnabled() || !SLUG.test(world) || !SLUG.test(slug)) return notFound();
  const r = await db.query<Card>(
    `SELECT i.title, w.name AS world_name, w.color AS world_color FROM items i JOIN worlds w ON w.id = i.world_id
     WHERE w.slug = $1 AND i.slug = $2 AND ${socialEligibleWhere('$3')} AND ($4::text[] IS NULL OR i.audience = ANY($4::text[]))`,
    [world, slug, now.toISOString(), o.audiences ?? null],
  );
  if (!r.rows[0]) return notFound();
  const key = JSON.stringify([world, slug, r.rows[0].title, r.rows[0].world_name, r.rows[0].world_color]);
  let jpeg = cache.get(key);
  if (jpeg) {
    remember(key, jpeg);
  } else {
    const allow = o.limiter ?? renderLimiter;
    if (!allow(clientPrefix(o.client ?? 'unknown'))) return new Response('Too many requests', { status: 429, headers: { 'retry-after': '60' } });
    const png = Buffer.from(await card(r.rows[0]).arrayBuffer());
    jpeg = await sharp(png).flatten({ background: CREAM }).jpeg({ quality: 88 }).toBuffer();
    remember(key, jpeg);
  }
  return new Response(new Uint8Array(jpeg), {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=3600' },
  });
}
