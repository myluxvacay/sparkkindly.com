import fs from 'node:fs';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { CREAM, INK, PLUM, plainTitle, wrapTitle } from './public/palette';

// The per-printable share card (1200x630, owner direction 22 Nov 2026): the Spark logo header
// treatment, the printable's title typeset, and a preview of the sheet art — so a Facebook,
// Pinterest, WhatsApp or X share carries the brand and the picture, and its link brings the next
// family to the printable's page. Built with next/og like the template image; the artwork is
// embedded as a data URI (resized with sharp) because the renderer must not fetch anything.

const GOLD = '#f7c948';
const TEAL = '#2f7f76';

async function dataUri(file: string, width: number, format: 'png' | 'jpeg'): Promise<string | null> {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'public', file.replace(/^\//, '')));
    const out = await sharp(raw)
      .resize({ width, withoutEnlargement: false })
      .toFormat(format, format === 'jpeg' ? { quality: 80 } : {})
      .toBuffer();
    return `data:image/${format};base64,${out.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function printableCardImage(opts: {
  title: string;
  kicker: string;
  artSrc: string | null;
}): Promise<ImageResponse> {
  const [badge, art, wave] = await Promise.all([
    dataUri('/brand/sparkkindly-logo-circle.png', 220, 'png'),
    opts.artSrc ? dataUri(opts.artSrc, 520, 'jpeg') : Promise.resolve(null),
    dataUri('/brand/rainbow-wave.png', 1200, 'png'),
  ]);
  const lines = wrapTitle(plainTitle(opts.title), 24, 3);
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: CREAM,
          padding: '48px 56px',
          borderTop: `20px solid ${TEAL}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            {badge ? <img src={badge} width={104} height={104} alt="" /> : null}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 26,
              fontWeight: 700,
              color: INK,
              background: GOLD,
              padding: '8px 24px',
              borderRadius: 40,
            }}
          >
            FREE PRINTABLE
          </div>
        </div>
        <div style={{ display: 'flex', flexGrow: 1, alignItems: 'center', gap: 40, marginTop: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
            <div style={{ display: 'flex', fontSize: 28, color: TEAL, fontWeight: 700, marginBottom: 14 }}>{opts.kicker}</div>
            {lines.map((l, i) => (
              <div key={i} style={{ display: 'flex', fontSize: 58, lineHeight: 1.12, color: PLUM, fontWeight: 700 }}>
                {l}
              </div>
            ))}
          </div>
          {art ? (
            <img
              src={art}
              width={340}
              height={340}
              alt=""
              style={{ borderRadius: 24, objectFit: 'cover', border: `6px solid ${GOLD}` }}
            />
          ) : null}
        </div>
        <div style={{ display: 'flex', fontSize: 26, color: INK }}>sparkkindly.com/printables — Think sharp. Be kind.</div>
        {wave ? (
          <img src={wave} width={1088} height={30} alt="" style={{ marginTop: 22, objectFit: 'cover', borderRadius: 15 }} />
        ) : null}
      </div>
    ),
    { width: 1200, height: 630, headers: { 'cache-control': 'public, max-age=86400' } },
  );
}
