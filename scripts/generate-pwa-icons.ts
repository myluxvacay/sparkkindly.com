// Generates the PWA icon set in public/icons/ from the owner's 1024px app icon
// (sparkkindly-app-icon-1024.png in the goal workspace's files/). Run manually when the
// source artwork changes: npx tsx scripts/generate-pwa-icons.ts — the outputs are
// committed, so the build never depends on the source file being present.
// The maskable variant pads the artwork into the safe zone on the brand plum, so a
// circle-cropped launcher icon never clips the heart.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const SOURCE =
  process.env.PWA_ICON_SOURCE ??
  path.join(
    process.env.HOME ?? '',
    'workspace/goals/mylux-vacation-seo-review-sparkkindly-brand-launch/files/sparkkindly-app-icon-1024.png',
  );
const OUT = path.join(process.cwd(), 'public', 'icons');
const PLUM = { r: 0x5b, g: 0x2c, b: 0x6f, alpha: 1 };

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const src = sharp(SOURCE);
  const meta = await src.metadata();
  if (meta.width !== 1024 || meta.height !== 1024) {
    throw new Error(`expected a 1024x1024 source icon, got ${meta.width}x${meta.height}`);
  }
  await sharp(SOURCE).resize(192, 192).png().toFile(path.join(OUT, 'icon-192.png'));
  await sharp(SOURCE).resize(512, 512).png().toFile(path.join(OUT, 'icon-512.png'));
  await sharp(SOURCE).resize(180, 180).png().toFile(path.join(OUT, 'apple-touch-icon.png'));
  const inner = await sharp(SOURCE).resize(410, 410).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: PLUM } })
    .composite([{ input: inner, gravity: 'centre' }])
    .png()
    .toFile(path.join(OUT, 'icon-maskable-512.png'));
  console.log('PWA icons written to public/icons/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
