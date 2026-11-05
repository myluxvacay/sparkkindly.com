// The branded share image for social posts (plan 5A): 1080x1350 (Instagram's 4:5 portrait), title, world colour and
// name, the SparkKindly wordmark; no personal data, no faces, no user content. Rendered by next/og (PNG) and converted to
// JPEG with sharp (already in the tree; Instagram accepts only JPEG). Served only for an item eligible for social
// media, read by world and slug alone (no session), so it is the same for everyone and publicly cacheable.
// Verified by tests/unit/social-share-image.test.ts.
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { socialEnabled } from '@/lib/config';
import type { Queryable } from '@/lib/db';
import { CREAM, INK, PLUM, plainTitle, worldHex, wrapTitle } from '@/lib/public/palette';
import { socialEligibleWhere } from './eligibility';

const SLUG = /^[a-z0-9-]{1,80}$/;
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

export async function socialShareImage(db: Queryable, world: string, slug: string, now: Date): Promise<Response> {
  if (!socialEnabled() || !SLUG.test(world) || !SLUG.test(slug)) return notFound();
  const r = await db.query<Card>(
    `SELECT i.title, w.name AS world_name, w.color AS world_color FROM items i JOIN worlds w ON w.id = i.world_id
     WHERE w.slug = $1 AND i.slug = $2 AND ${socialEligibleWhere('$3')}`,
    [world, slug, now.toISOString()],
  );
  if (!r.rows[0]) return notFound();
  const png = Buffer.from(await card(r.rows[0]).arrayBuffer());
  const jpeg = await sharp(png).flatten({ background: CREAM }).jpeg({ quality: 88 }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=3600' },
  });
}
