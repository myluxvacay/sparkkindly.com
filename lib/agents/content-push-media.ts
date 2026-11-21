import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import sharp from 'sharp';
import type { EnvLike } from '@/lib/env';
import { isSafeSourceUrl, pinnedLookup } from '@/lib/items/net-safety';

// Media for the Content Push API. Uploaded binaries live OUTSIDE the release (releases are immutable and
// swapped on deploy): in a per-environment shared directory named by PUSH_MEDIA_DIR, the same arrangement
// as SOCIAL_MEDIA_DIR for video jobs. The database stores only the reference (the /api/push-media/ URL in
// items.image), never a payload (repo policy). Files are named by item id, so a re-upload replaces the
// item's own files and nothing else; the serving route only ever reads names of this shape.

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // a generated hero is ~1-3 MB; 12 MB is generous headroom
export const MAX_VIDEO_BYTES = 256 * 1024 * 1024; // matches the social upload ceiling in OPERATIONS
const VARIANT_WIDTHS = [480, 960, 1600] as const; // scripts/prepare-images.ts, the manifest recipe

export const pushMediaDir = (env: EnvLike): string =>
  (env.PUSH_MEDIA_DIR ?? '').trim() || '/opt/sparkkindly/shared/media/push';

export const heroSrc = (itemId: string): string => `/api/push-media/${itemId}.webp`;
export const videoFileName = (itemId: string): string => `${itemId}.mp4`;
export const videoPath = (dir: string, itemId: string): string => path.join(dir, 'video', videoFileName(itemId));

const FILE_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-(480|960|1600))?\.(webp|avif)$/;

export function parseMediaFileName(file: string): { name: string; ext: string; itemId: string } | null {
  const m = FILE_PATTERN.exec(file);
  return m ? { name: file, ext: m[3], itemId: m[1] } : null;
}

export async function readMediaFile(dir: string, file: string): Promise<{ bytes: Buffer; type: string } | null> {
  const parsed = parseMediaFileName(file);
  if (!parsed) return null;
  try {
    const bytes = await readFile(path.join(dir, parsed.name));
    return { bytes, type: parsed.ext === 'webp' ? 'image/webp' : 'image/avif' };
  } catch {
    return null;
  }
}

export type StoredHero = { src: string; width: number; height: number };

// Converts one uploaded image (PNG/JPEG/WebP bytes, verified by decoding) into the standard hero set:
// the main WebP (at most 1600 wide) plus the 480/960/1600 WebP and AVIF variants the Picture component
// derives from the src. Returns the stored dimensions of the main image.
export async function storeHeroImage(dir: string, itemId: string, bytes: Uint8Array): Promise<StoredHero> {
  let meta: { width?: number; height?: number; format?: string };
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    throw new Error('not an image');
  }
  if (!meta.width || !meta.height || !['png', 'jpeg', 'webp'].includes(meta.format ?? '')) throw new Error('not an image');
  await mkdir(dir, { recursive: true });
  const base = path.join(dir, itemId);
  // The whole set is rendered under temporary names and renamed into place only when every variant
  // exists: a failure mid-set (an encoder error, a full disk) never leaves a mixed old/new set being
  // served under the item's deterministic src.
  const stamp = `${process.pid}-${Date.now().toString(36)}`;
  const jobs: { tmp: string; final: string; width?: number; format: 'webp' | 'avif' }[] = [
    { tmp: `${base}.tmp-${stamp}.webp`, final: `${base}.webp`, format: 'webp' },
    ...VARIANT_WIDTHS.flatMap((width) => [
      { tmp: `${base}-${width}.tmp-${stamp}.webp`, final: `${base}-${width}.webp`, width, format: 'webp' as const },
      { tmp: `${base}-${width}.tmp-${stamp}.avif`, final: `${base}-${width}.avif`, width, format: 'avif' as const },
    ]),
  ];
  try {
    for (const job of jobs) {
      const p = sharp(bytes).rotate().resize({ width: job.width ?? 1600, withoutEnlargement: true });
      await (job.format === 'webp' ? p.webp({ quality: 75 }) : p.avif({ quality: 45 })).toFile(job.tmp);
    }
    for (const job of jobs) await rename(job.tmp, job.final);
  } finally {
    for (const job of jobs) await rm(job.tmp, { force: true });
  }
  const main = await sharp(`${base}.webp`).metadata();
  return { src: heroSrc(itemId), width: main.width ?? meta.width, height: main.height ?? meta.height };
}

// Writes a web stream to `file` chunk by chunk under a hard cap (never whole in memory). Returns the byte
// count, or null when the cap was exceeded; the partial file is removed either way on failure.
export async function streamToFile(body: ReadableStream<Uint8Array> | null, file: string, cap: number): Promise<number | null> {
  if (!body) return 0;
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  const out = createWriteStream(tmp, { mode: 0o600 });
  const reader = body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel();
        out.destroy();
        return null;
      }
      await new Promise<void>((resolve, reject) => out.write(value, (e) => (e ? reject(e) : resolve())));
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
    await rename(tmp, file);
    return total;
  } finally {
    out.destroy();
    await rm(tmp, { force: true });
  }
}

// Downloads a video from an https URL the agent named, into the media dir. Address safety is the probe's
// (lib/items/probe.ts): the connection's own DNS lookup is pinned to the vetted address, so the address
// checked is the address connected to. No redirects: a redirect answer is an error naming the fix, rather
// than a hop to an unvetted address. The body streams to disk under the cap.
export async function fetchVideoToFile(
  url: string,
  file: string,
  deps: { cap?: number; timeoutMs?: number } = {},
): Promise<{ size: number } | { error: string }> {
  if (!isSafeSourceUrl(url)) return { error: 'not an allowed video address' };
  const cap = deps.cap ?? MAX_VIDEO_BYTES;
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  try {
    const size = await new Promise<number | string>((resolve) => {
      const u = new URL(url);
      const req = https.request(
        {
          method: 'GET',
          hostname: u.hostname,
          port: u.port || 443,
          path: `${u.pathname}${u.search}`,
          servername: u.hostname.replace(/\.+$/, ''),
          headers: { 'user-agent': 'SparkKindlyBot/1.0 (+https://sparkkindly.com)', accept: 'video/mp4' },
          lookup: pinnedLookup(),
          signal: AbortSignal.timeout(deps.timeoutMs ?? 300_000),
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.destroy();
            return resolve('the video address redirects; give the direct file address');
          }
          if (status < 200 || status >= 300) {
            res.destroy();
            return resolve(`the video address answered ${status}`);
          }
          const type = res.headers['content-type'] ?? '';
          if (!type.startsWith('video/mp4') && !type.startsWith('application/octet-stream')) {
            res.destroy();
            return resolve(`the video address served ${type || 'an unknown type'}, not an MP4`);
          }
          const declared = Number(res.headers['content-length']);
          if (Number.isFinite(declared) && declared > cap) {
            res.destroy();
            return resolve('the video is larger than the upload limit');
          }
          const out = createWriteStream(tmp, { mode: 0o600 });
          let total = 0;
          res.on('data', (chunk: Buffer) => {
            total += chunk.byteLength;
            if (total > cap) {
              res.destroy();
              out.destroy();
              resolve('the video is larger than the upload limit');
            }
          });
          res.pipe(out);
          out.on('finish', () => resolve(total));
          out.on('error', () => resolve('the video could not be saved'));
          res.on('error', () => resolve('the video could not be fetched'));
        },
      );
      req.on('error', () => resolve('the video could not be fetched'));
      req.end();
    });
    if (typeof size === 'string') return { error: size };
    if (size === 0) return { error: 'the video file is empty' };
    await rename(tmp, file);
    return { size };
  } finally {
    await rm(tmp, { force: true });
  }
}

export async function storedVideoSize(dir: string, itemId: string): Promise<number | null> {
  try {
    return (await stat(videoPath(dir, itemId))).size;
  } catch {
    return null;
  }
}

export async function readStoredVideoSize(file: string): Promise<number | null> {
  try {
    return (await stat(file)).size;
  } catch {
    return null;
  }
}

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export async function fileSha256(file: string): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const hash = createHash('sha256');
    const buf = new Uint8Array(1024 * 1024);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
    }
    return hash.digest('hex');
  } finally {
    await fh.close();
  }
}
