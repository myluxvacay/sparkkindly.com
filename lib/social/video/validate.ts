// Checks an uploaded video by its content, never by a header or a name (plan 5B, media-storage.md). The file must be an
// ISO base media (MP4) container: the top-level boxes are walked from the first byte to the last and must be known MP4
// box types that exactly fill the file (so an MP4 header followed by a zip, a script or any other trailing content, a
// polyglot, is refused), starting with `ftyp` of an MP4 brand (QuickTime refused) and holding `moov` and `mdat`; the
// `moov` box must describe an H.264 track (`avc1`/`avc3`). When ffprobe is installed on the VM it also reads the codec,
// duration and resolution (H.264 required, at most 3 minutes); without it, a warning says only the container was
// checked. No Next.js imports. Verified by tests/unit/social-video-upload.test.ts.
import { execFile } from 'node:child_process';
import { open, type FileHandle } from 'node:fs/promises';

export type ProbeInfo = { codec: string; duration: number; width: number; height: number };
export type Probe = (path: string) => Promise<ProbeInfo | null>; // null: ffprobe is not installed
export type Validation = { ok: boolean; errors: string[]; warnings: string[]; durationSeconds?: number; width?: number; height?: number };

const BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1']);
const TOP_LEVEL = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'uuid', 'meta', 'udta', 'pdin', 'moof', 'mfra', 'styp', 'sidx']);
const MAX_MOOV_BYTES = 64 * 1024 * 1024;
const MAX_SECONDS = 180;

type Box = { type: string; start: number; size: number; header: number };

async function readAt(fh: FileHandle, at: number, length: number): Promise<Buffer> {
  const b = Buffer.alloc(length);
  const { bytesRead } = await fh.read(b, 0, length, at);
  return b.subarray(0, bytesRead);
}

async function boxes(fh: FileHandle, fileSize: number): Promise<Box[]> {
  const out: Box[] = [];
  for (let at = 0; at < fileSize; ) {
    const h = await readAt(fh, at, 16);
    if (h.length < 8) throw new Error('truncated box header');
    const type = h.toString('latin1', 4, 8);
    if (!TOP_LEVEL.has(type)) throw new Error('unexpected content in the container (not an MP4 box)');
    let size = h.readUInt32BE(0);
    let header = 8;
    if (size === 1) {
      if (h.length < 16) throw new Error('truncated box header');
      size = Number(h.readBigUInt64BE(8));
      header = 16;
    } else if (size === 0) size = fileSize - at; // to the end of the file
    if (size < header || at + size > fileSize) throw new Error('a box does not fit the file');
    out.push({ type, start: at, size, header });
    at += size;
  }
  return out;
}

async function containerErrors(path: string): Promise<string[]> {
  const fh = await open(path, 'r');
  try {
    const size = (await fh.stat()).size;
    if (size < 16) return ['the file is empty or too short'];
    const list = await boxes(fh, size);
    if (list[0].type !== 'ftyp') return ['not an MP4 file (no ftyp box first)'];
    const brand = (await readAt(fh, list[0].header, 4)).toString('latin1');
    if (!BRANDS.has(brand)) return [`not an MP4 brand (${brand.replace(/[^\x20-\x7e]/g, '?')})`];
    const moov = list.find((b) => b.type === 'moov');
    if (!moov || !list.some((b) => b.type === 'mdat')) return ['the MP4 has no movie or media data'];
    if (moov.size > MAX_MOOV_BYTES) return ['the MP4 movie box is too large'];
    const body = await readAt(fh, moov.start, moov.size);
    if (!body.includes('avc1') && !body.includes('avc3')) return ['the video is not H.264'];
    return [];
  } catch (err) {
    return [(err as Error).message];
  } finally {
    await fh.close();
  }
}

export const ffprobe: Probe = (path) =>
  new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', path];
    execFile('ffprobe', args, { timeout: 20_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return resolve(null);
      if (err) return reject(new Error('ffprobe could not read the file'));
      try {
        const j = JSON.parse(stdout) as { streams?: { codec_name?: string; width?: number; height?: number }[]; format?: { duration?: string } };
        const s = j.streams?.[0] ?? {};
        resolve({ codec: s.codec_name ?? '', duration: Number(j.format?.duration), width: s.width ?? 0, height: s.height ?? 0 });
      } catch {
        reject(new Error('ffprobe could not read the file'));
      }
    });
  });

export async function validateMp4(path: string, o: { probe?: Probe } = {}): Promise<Validation> {
  const errors = await containerErrors(path);
  if (errors.length) return { ok: false, errors, warnings: [] };
  let info: ProbeInfo | null;
  try {
    info = await (o.probe ?? ffprobe)(path);
  } catch (err) {
    return { ok: false, errors: [(err as Error).message], warnings: [] };
  }
  if (!info) return { ok: true, errors: [], warnings: ['ffprobe is not installed: only the container was checked (duration and resolution unknown)'] };
  if (info.codec !== 'h264') errors.push('the video is not H.264');
  if (!(info.duration > 0 && info.duration <= MAX_SECONDS)) errors.push(`the video must be at most ${MAX_SECONDS} seconds long`);
  return { ok: errors.length === 0, errors, warnings: [], durationSeconds: info.duration, width: info.width, height: info.height };
}
