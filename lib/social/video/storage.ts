// Where uploaded video files live (plan 5B, media-storage.md): SOCIAL_MEDIA_DIR (default
// /opt/sparkkindly/shared/media/social, outside the repo and outside public/), with `quarantine/` for uploads waiting
// for the owner and `approved/` for files the owner approved. Nothing serves either folder; the worker reads approved
// files to upload them to the platforms. File names are always server-generated (`<job>-<32 hex>.<ext>`) and checked
// again before any path is built, so no client text ever reaches a path. Folders are 0700 and files 0600. A folder that
// is a symlink is refused. No Next.js imports. Verified by tests/unit/social-video-upload.test.ts.
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { EnvLike } from '@/lib/env';

export type MediaDirs = { root: string; quarantine: string; approved: string };
export type Ext = 'mp4' | 'vtt' | 'srt';

const DEFAULT_ROOT = '/opt/sparkkindly/shared/media/social';
const NAME = /^[0-9]{1,12}-[0-9a-f]{32}\.(mp4|vtt|srt)$/;

export function mediaDirs(env: EnvLike): MediaDirs {
  const set = (env.SOCIAL_MEDIA_DIR ?? '').trim();
  const root = set ? path.resolve(set) : DEFAULT_ROOT;
  return { root, quarantine: path.join(root, 'quarantine'), approved: path.join(root, 'approved') };
}

export async function ensureDirs(d: MediaDirs): Promise<void> {
  for (const dir of [d.quarantine, d.approved]) await mkdir(dir, { recursive: true, mode: 0o700 });
}

export class StorageError extends Error {}

// Both folders must be real directories (not symlinks), so a link can never send a file elsewhere.
export async function checkDirs(d: MediaDirs): Promise<void> {
  for (const dir of [d.quarantine, d.approved]) {
    const s = await lstat(dir).catch(() => null);
    if (!s || !s.isDirectory() || s.isSymbolicLink()) throw new StorageError('media folder missing or not a directory');
  }
}

export const newName = (jobId: number, ext: Ext): string => `${jobId}-${randomBytes(16).toString('hex')}.${ext}`;

export function pathIn(dir: string, name: string): string {
  if (!NAME.test(name)) throw new StorageError('bad file name');
  const p = path.join(dir, name);
  if (path.dirname(p) !== dir) throw new StorageError('bad file name');
  return p;
}

export async function sha256File(p: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(p)) h.update(chunk as Buffer);
  return h.digest('hex');
}

const isFile = async (p: string) => {
  const s = await lstat(p).catch(() => null);
  return !!s && s.isFile() && !s.isSymbolicLink();
};

// Where a job's file is now: approved first (an approval moves it), else quarantine; null when it is gone.
export async function findFile(d: MediaDirs, name: string): Promise<{ path: string; where: 'quarantine' | 'approved' } | null> {
  if (await isFile(pathIn(d.approved, name))) return { path: pathIn(d.approved, name), where: 'approved' };
  if (await isFile(pathIn(d.quarantine, name))) return { path: pathIn(d.quarantine, name), where: 'quarantine' };
  return null;
}

// Moves files from quarantine to approved with rename (atomic on one filesystem); a file already moved is fine.
export async function approveFiles(d: MediaDirs, names: string[]): Promise<void> {
  await checkDirs(d);
  for (const name of names) {
    const found = await findFile(d, name);
    if (!found) throw new StorageError('file missing');
    if (found.where === 'quarantine') await rename(found.path, pathIn(d.approved, name));
  }
}

export async function removeFile(d: MediaDirs, name: string | null): Promise<void> {
  if (!name || !NAME.test(name)) return;
  for (const dir of [d.quarantine, d.approved]) await rm(pathIn(dir, name), { force: true });
}

// Bytes in quarantine, for the global quota.
export async function usage(dir: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    total += (await stat(path.join(dir, name)).catch(() => null))?.size ?? 0;
  }
  return total;
}
