import { ImageResponse } from 'next/og';
import type { PublicItem } from '@/lib/items/repo';
import { CREAM, INK, PLUM, worldHex, wrapTitle } from './palette';

// 1200x630 branded card. No external font or emoji (Satori would fetch them from a CDN): the bundled default font,
// and the world name in a badge in place of the icon glyph.
export function templateImage(item: PublicItem, world: { name: string; color: string | null }): ImageResponse {
  const accent = worldHex(world.color ?? '');
  const lines = wrapTitle(item.title, 28, 4);
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
          padding: 72,
          borderLeft: `24px solid ${accent}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 40, color: PLUM }}>SparkKindly</div>
          <div
            style={{ display: 'flex', fontSize: 32, fontWeight: 700, color: INK, background: accent, padding: '10px 28px', borderRadius: 40 }}
          >
            {world.name}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 72, lineHeight: 1.15, color: PLUM }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'flex' }}>
              {l}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', fontSize: 28, color: INK }}>sparkkindly.com</div>
      </div>
    ),
    { width: 1200, height: 630, headers: { 'cache-control': 'public, max-age=86400' } },
  );
}
