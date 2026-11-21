import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Step-strip share cards (owner request, 21 Nov 2026): compose the 1200x630 social card for an
// article's step strip from its panel crops — the same art, in step order, as a 2x2 grid with
// white gutters on a white plate over a soft tint sampled from the first panel's sky. No text is
// baked in (the locked no-text rule); the panels are the teaser.
//
// Usage: npm run images:step-share-card -- <strip-base> [<strip-base> ...]
//   <strip-base> is the strip file name without extension, e.g. poster-volcano-model-steps
//   Panels are read from public/images/<strip-base>-1.webp, -2.webp, ... in step order.
//   The card is written to public/images/<strip-base>-share.jpg (the URL lib/public/step-share-card.ts
//   derives from the strip src) and registered in public/images/manifest.json if not already there.

const CARD_W = 1200;
const CARD_H = 630;
const MARGIN = 28; // card edge to the white plate
const PLATE_PAD = 14; // white plate around the panel grid
const GUTTER = 14; // white gutter between panels
const COLS = 2;

const imagesDir = path.join(process.cwd(), 'public', 'images');
const manifestPath = path.join(imagesDir, 'manifest.json');

type ManifestEntry = { file: string; sourceUrl: string; license: string; status: string; downloadedAt: string; publicUseAuthorizedAt: string };

async function panelFiles(base: string): Promise<string[]> {
  const files: string[] = [];
  for (let n = 1; ; n++) {
    const f = path.join(imagesDir, `${base}-${n}.webp`);
    try {
      await fs.access(f);
      files.push(f);
    } catch {
      break;
    }
  }
  return files;
}

// The card background: the average colour of the first panel's top band (its sky), blended
// towards white so the white plate and gutters stay the visual focus.
async function backgroundFor(firstPanel: string): Promise<{ r: number; g: number; b: number }> {
  const meta = await sharp(firstPanel).metadata();
  const bandH = Math.max(8, Math.floor((meta.height ?? 100) * 0.15));
  const stats = await sharp(firstPanel)
    .extract({ left: 0, top: 0, width: meta.width ?? 100, height: bandH })
    .stats();
  const [r, g, b] = stats.channels.map((c) => Math.round(c.mean * 0.45 + 255 * 0.55));
  return { r, g, b };
}

async function makeCard(base: string): Promise<string> {
  const panels = await panelFiles(base);
  if (panels.length < 2) throw new Error(`${base}: found ${panels.length} panel file(s), need at least 2`);
  const rows = Math.ceil(panels.length / COLS);

  const metas = await Promise.all(panels.map((p) => sharp(p).metadata()));
  const aspect = (metas[0].width ?? 1) / (metas[0].height ?? 1);

  // Fit the grid inside the plate: cells sized by whichever dimension binds.
  const availW = CARD_W - 2 * MARGIN - 2 * PLATE_PAD - (COLS - 1) * GUTTER;
  const availH = CARD_H - 2 * MARGIN - 2 * PLATE_PAD - (rows - 1) * GUTTER;
  const cellW = Math.min(availW / COLS, (availH / rows) * aspect);
  const cellH = cellW / aspect;
  const gridW = COLS * cellW + (COLS - 1) * GUTTER;
  const gridH = rows * cellH + (rows - 1) * GUTTER;
  const gridX = Math.round((CARD_W - gridW) / 2);
  const gridY = Math.round((CARD_H - gridH) / 2);

  const resized = await Promise.all(
    panels.map((p) => sharp(p).resize(Math.round(cellW), Math.round(cellH)).png().toBuffer()),
  );

  const plate = Buffer.from(
    `<svg width="${CARD_W}" height="${CARD_H}"><rect x="${gridX - PLATE_PAD}" y="${gridY - PLATE_PAD}" width="${gridW + 2 * PLATE_PAD}" height="${gridH + 2 * PLATE_PAD}" rx="24" fill="#ffffff"/></svg>`,
  );

  const out = path.join(imagesDir, `${base}-share.jpg`);
  await sharp({ create: { width: CARD_W, height: CARD_H, channels: 3, background: await backgroundFor(panels[0]) } })
    .composite([
      { input: plate, left: 0, top: 0 },
      ...resized.map((input, i) => ({
        input,
        left: Math.round(gridX + (i % COLS) * (cellW + GUTTER)),
        top: Math.round(gridY + Math.floor(i / COLS) * (cellH + GUTTER)),
      })),
    ])
    .jpeg({ quality: 88 })
    .toFile(out);
  return out;
}

async function registerInManifest(base: string): Promise<void> {
  const file = `${base}-share.jpg`;
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ManifestEntry[];
  if (manifest.some((e) => e.file === file)) return;
  manifest.push({
    file,
    sourceUrl: `Share card (1200x630) composed from the ${base} step-strip panels — AI-generated art for SparkKindly with Google Gemini (owner-commissioned, 2026-11-21)`,
    license: 'Owner-generated work; no third-party licence applies',
    status: 'Owner-authorized public publication',
    downloadedAt: '2026-11-21',
    publicUseAuthorizedAt: '2026-11-21',
  });
  // The manifest's house format is a 1-space indent; keep it so the diff stays append-only.
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
}

const bases = process.argv.slice(2);
if (bases.length === 0) {
  console.error('Usage: npm run images:step-share-card -- <strip-base> [<strip-base> ...]');
  process.exit(1);
}
for (const base of bases) {
  const out = await makeCard(base);
  await registerInManifest(base);
  const meta = await sharp(out).metadata();
  console.log(`${path.basename(out)}: ${meta.width}x${meta.height} ${meta.format}`);
}
