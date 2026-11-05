// The video media purge (plan 5B), run once a day by the worker with SOCIAL_ENABLED on: quarantine files (uploads never
// approved, partial files, stale locks) older than 7 days are deleted, and so are the files of jobs cancelled more than
// 30 days ago (the job keeps its row; its file name is cleared). Approved files of live jobs are never touched.
// No Next.js imports. Verified by tests/unit/social-video-upload.test.ts and social-video-admin.test.tsx.
import { lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Queryable } from '@/lib/db';
import { removeFile, type MediaDirs } from '@/lib/social/video/storage';

const QUARANTINE_DAYS = 7;
const CANCELLED_DAYS = 30;
const DAY_MS = 86_400_000;

export async function purgeQuarantine(dirs: MediaDirs, now: Date): Promise<number> {
  const cutoff = now.getTime() - QUARANTINE_DAYS * DAY_MS;
  let removed = 0;
  for (const name of await readdir(dirs.quarantine).catch(() => [] as string[])) {
    const p = path.join(dirs.quarantine, name);
    const s = await lstat(p).catch(() => null);
    if (s && !s.isDirectory() && s.mtimeMs < cutoff) {
      await rm(p, { force: true });
      removed++;
    }
  }
  return removed;
}

export async function purgeCancelledMedia(db: Queryable, dirs: MediaDirs, now: Date): Promise<number> {
  const r = await db.query<{ id: string; file_name: string | null; captions_path: string | null }>(
    `SELECT id, file_name, captions_path FROM video_jobs
     WHERE state = 'cancelled' AND updated_at < $1 AND (file_name IS NOT NULL OR captions_path IS NOT NULL)`,
    [new Date(now.getTime() - CANCELLED_DAYS * DAY_MS).toISOString()],
  );
  for (const j of r.rows) {
    await removeFile(dirs, j.file_name);
    await removeFile(dirs, j.captions_path);
    await db.query('UPDATE video_jobs SET file_name = NULL, captions_path = NULL WHERE id = $1', [j.id]);
  }
  return r.rows.length;
}
