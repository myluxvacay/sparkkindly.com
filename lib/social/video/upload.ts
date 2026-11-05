// Receiving one uploaded file (plan 5B, media-storage.md): the owner declares the size first (the intent); a declared
// size over the limit (video 128 MB by default, captions 200 KB) is refused before a byte is read, and the stream is cut the moment
// it passes the declared size, so nothing is ever buffered whole. The client's file name only has to look like one
// plain `name.mp4` (or `.vtt`/`.srt`): no path, no second extension; it is then discarded and the file is written under a
// server-generated name, first as `<name>.part` (created exclusively, mode 0600) and renamed when complete. One upload
// per job at a time (an exclusive lock file with a nonce; a lock older than an hour is stale). A global quarantine quota
// and a free-space check guard the disk. The video limit is maxVideoBytes (128 MB by default). Any failure (aborted, oversize, short) removes the partial file. SHA-256 is computed while streaming.
// No Next.js imports. Verified by tests/unit/social-video-upload.test.ts.
import { createHash } from 'node:crypto';
import { open, rename, rm, statfs } from 'node:fs/promises';
import type { EnvLike } from '@/lib/env';
import { acquireLock } from '../lockfile';
import path from 'node:path';
import { checkDirs, newName, pathIn, usage, type Ext, type MediaDirs } from './storage';

const MB = 1024 * 1024;
export const MAX_VIDEO_BYTES = 256 * MB; // the hard ceiling
const DEFAULT_VIDEO_MB = 128;
// 5B review M4: 128 MB unless SOCIAL_MAX_VIDEO_MB says otherwise, never above 256 MB.
export function maxVideoBytes(env: EnvLike): number {
  const v = Number((env.SOCIAL_MAX_VIDEO_MB ?? '').trim() || DEFAULT_VIDEO_MB);
  return Number.isInteger(v) && v > 0 ? Math.min(v * MB, MAX_VIDEO_BYTES) : DEFAULT_VIDEO_MB * MB;
}
const FREE_RESERVE = 1024 * MB;
export const MAX_CAPTIONS_BYTES = 200 * 1024;
// ponytail: one fixed quota for the whole quarantine folder; make it an env setting if the disk changes.
export const QUARANTINE_QUOTA = 2 * 1024 * 1024 * 1024;
const STALE_LOCK_MS = 3_600_000;

export type UploadKind = 'video' | 'captions';
export type UploadCode = 'too_large' | 'bad_name' | 'busy' | 'quota' | 'disk' | 'size_mismatch' | 'aborted' | 'storage';
export type UploadResult = { ok: true; name: string; sha256: string; size: number } | { ok: false; code: UploadCode };

type Opts = {
  body: ReadableStream<Uint8Array> | null;
  declaredSize: number;
  clientName: string;
  jobId: number;
  dirs: MediaDirs;
  kind: UploadKind;
  limit?: number;
  quota?: number;
  freeBytes?: () => Promise<number>; // for tests; the folder's free space otherwise
};

const freeSpace = async (dir: string) => {
  const s = await statfs(dir);
  return Number(s.bavail) * Number(s.bsize);
};

class Refused extends Error {
  constructor(public readonly code: UploadCode) {
    super(code);
  }
}

export function clientExt(name: string, kind: UploadKind): Ext | null {
  const m = /^[A-Za-z0-9 _()-]{1,100}\.(mp4|vtt|srt)$/i.exec(name);
  const ext = m?.[1].toLowerCase() as Ext | undefined;
  if (!ext || (kind === 'video') !== (ext === 'mp4')) return null;
  return ext;
}

async function lock(dirs: MediaDirs, jobId: number): Promise<() => Promise<void>> {
  const release = await acquireLock(path.join(dirs.quarantine, `${jobId}.lock`), STALE_LOCK_MS).catch(() => {
    throw new Refused('storage');
  });
  if (!release) throw new Refused('busy');
  return release;
}

async function stream(body: ReadableStream<Uint8Array>, part: string, declared: number): Promise<string> {
  const fh = await open(part, 'wx', 0o600);
  const hash = createHash('sha256');
  const reader = body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new Refused('aborted');
      }
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > declared) {
        await reader.cancel().catch(() => undefined);
        throw new Refused('too_large');
      }
      hash.update(chunk.value);
      await fh.write(chunk.value);
    }
  } finally {
    await fh.close();
  }
  if (bytes !== declared) throw new Refused('size_mismatch');
  return hash.digest('hex');
}

export async function receiveUpload(o: Opts): Promise<UploadResult> {
  const ext = clientExt(o.clientName, o.kind);
  if (!ext) return { ok: false, code: 'bad_name' };
  const max = o.kind === 'video' ? MAX_VIDEO_BYTES : MAX_CAPTIONS_BYTES;
  const limit = Math.min(o.limit ?? max, max);
  if (!Number.isSafeInteger(o.declaredSize) || o.declaredSize <= 0) return { ok: false, code: 'size_mismatch' };
  if (o.declaredSize > limit) return { ok: false, code: 'too_large' };
  if (!o.body) return { ok: false, code: 'aborted' };
  const name = newName(o.jobId, ext);
  let part: string | null = null;
  let unlock: (() => Promise<void>) | null = null;
  try {
    await checkDirs(o.dirs).catch(() => {
      throw new Refused('storage');
    });
    unlock = await lock(o.dirs, o.jobId);
    if ((await usage(o.dirs.quarantine)) + o.declaredSize > (o.quota ?? QUARANTINE_QUOTA)) throw new Refused('quota');
    // 5B review L2: keep the disk from filling (the file, its move, and a reserve for everything else).
    if ((await (o.freeBytes ?? (() => freeSpace(o.dirs.quarantine)))()) < 2 * o.declaredSize + FREE_RESERVE) throw new Refused('disk');
    const final = pathIn(o.dirs.quarantine, name);
    part = `${final}.part`;
    const sha256 = await stream(o.body, part, o.declaredSize);
    await rename(part, final);
    part = null;
    return { ok: true, name, sha256, size: o.declaredSize };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, code: err.code };
    console.error('video upload failed:', (err as Error)?.name);
    return { ok: false, code: 'storage' };
  } finally {
    if (part) await rm(part, { force: true });
    if (unlock) await unlock();
  }
}
