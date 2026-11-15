import { ImageResponse } from 'next/og';
import type { PublicItem } from '@/lib/items/repo';
import { CREAM, INK, PLUM, plainTitle, worldHex, wrapTitle } from './palette';

// 1200x630 branded card. No external font or emoji: Satori fetches them from a CDN for any character the bundled
// font lacks, so the title goes through plainTitle first, and the world name is a badge in place of the icon glyph.
export function templateImage(item: PublicItem, world: { name: string; color: string | null }): ImageResponse {
  const accent = worldHex(world.color ?? '');
  const lines = wrapTitle(plainTitle(item.title), 28, 4);
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

// The one preview image for every circle invite (plan 4B): brand and a fixed line only, never a circle or person's
// name, so the image says nothing about who invited whom and can be cached publicly.
export function inviteImage(): ImageResponse {
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
          borderLeft: `24px solid ${worldHex('coral')}`,
        }}
      >
        <div style={{ display: 'flex', fontSize: 40, color: PLUM }}>SparkKindly</div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 72, lineHeight: 1.15, color: PLUM }}>
          <div style={{ display: 'flex' }}>You are invited</div>
          <div style={{ display: 'flex' }}>to join a circle</div>
        </div>
        <div style={{ display: 'flex', fontSize: 28, color: INK }}>A daily set of quizzes and games, played together</div>
      </div>
    ),
    { width: 1200, height: 630, headers: { 'cache-control': 'public, max-age=86400' } },
  );
}

// The result card (teen UI pass, 15 Nov 2026): a portrait card a reader can save or post after answering.
// It carries the world colour, the question's title and one fixed line — never whether the answer was
// right, never a score or a rank, so sharing it cannot become a comparison. Same renderer rules as the
// template image: bundled-font characters only, via plainTitle.
export function resultCardImage(item: PublicItem, world: { name: string; color: string | null }): ImageResponse {
  const accent = worldHex(world.color ?? '');
  const lines = wrapTitle(plainTitle(item.title), 16, 5);
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: accent,
          padding: 84,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 44, fontWeight: 700, color: INK }}>SparkKindly</div>
          <div
            style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: CREAM, background: PLUM, padding: '10px 26px', borderRadius: 40 }}
          >
            {world.name}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, letterSpacing: 4, color: PLUM, marginBottom: 36 }}>
            {"I ANSWERED TODAY'S SPARK"}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 88, lineHeight: 1.12, fontWeight: 700, color: INK }}>
            {lines.map((l, i) => (
              <div key={i} style={{ display: 'flex' }}>
                {l}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: INK }}>Think sharp. Be kind. · sparkkindly.com</div>
      </div>
    ),
    { width: 1080, height: 1350, headers: { 'cache-control': 'public, max-age=86400' } },
  );
}
