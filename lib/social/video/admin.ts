// The owner's reads of video jobs (plan 5B): the /admin/social/videos/ list and one job's page. File names and folders
// never leave the server; the page gets the checksum, size, validation and whether captions exist. No Next.js imports.
// Verified by tests/unit/social-video-admin.test.tsx.
import type { Queryable } from '@/lib/db';
import type { DistStatus, VideoPlatform } from '../states';
import type { Brief } from './brief';
import type { Validation } from './validate';
import type { VideoState } from './states';

export type VideoJobRow = {
  id: number; platform: VideoPlatform; state: VideoState; title: string; world: string; distributionStatus: DistStatus;
  postUrl: string | null; updatedAt: Date;
};
export type VideoJobView = VideoJobRow & {
  version: number; itemId: string; brief: (Brief & { assets?: { logo: string; worldColour: string; frames: string[] } }) | null;
  hasFile: boolean; fileSha256: string | null; fileSize: number | null; validation: Validation | null; hasCaptions: boolean;
  captionsSha256: string | null; captionsPreview: string[];
  captionsBurned: boolean; approvedChecksum: string | null; approvedAt: Date | null; makerNote: string | null;
  licenceNote: string | null; scheduledFor: Date | null; postedAt: Date | null; lastError: string | null;
};

const BASE = `SELECT j.id, j.platform, j.state, i.title, w.slug AS world, d.status AS dstatus, d.post_url, j.updated_at
  FROM video_jobs j JOIN items i ON i.id = j.item_id JOIN worlds w ON w.id = i.world_id JOIN distributions d ON d.id = j.distribution_id`;

const row = (x: Record<string, unknown>): VideoJobRow => ({
  id: Number(x.id), platform: x.platform as VideoPlatform, state: x.state as VideoState, title: x.title as string,
  world: x.world as string, distributionStatus: x.dstatus as DistStatus, postUrl: x.post_url as string | null,
  updatedAt: x.updated_at as Date,
});

// Open jobs, and closed ones from the last 30 days.
export async function videoJobs(db: Queryable, now: Date): Promise<VideoJobRow[]> {
  const r = await db.query<Record<string, unknown>>(
    `${BASE} WHERE j.state NOT IN ('cancelled') OR j.updated_at > $1::timestamptz - interval '30 days'
     ORDER BY j.updated_at DESC, j.id DESC LIMIT 200`,
    [now.toISOString()],
  );
  return r.rows.map(row);
}

export async function videoJob(db: Queryable, id: number): Promise<VideoJobView | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const r = await db.query<Record<string, unknown>>(
    `SELECT j.id, j.platform, j.state, i.title, w.slug AS world, d.status AS dstatus, d.post_url, j.updated_at, j.version,
            j.item_id, j.brief, j.file_name, j.file_sha256, j.file_size, j.validation, j.captions_path, j.captions_burned,
            j.approved_checksum, j.approved_at, j.maker_note, j.licence_note, d.scheduled_for, d.posted_at, d.last_error,
            j.captions_sha256, j.captions_preview
     FROM video_jobs j JOIN items i ON i.id = j.item_id JOIN worlds w ON w.id = i.world_id
     JOIN distributions d ON d.id = j.distribution_id WHERE j.id = $1`,
    [id],
  );
  const x = r.rows[0];
  if (!x) return null;
  return {
    ...row(x),
    version: x.version as number, itemId: x.item_id as string, brief: x.brief as VideoJobView['brief'],
    hasFile: !!x.file_name, fileSha256: x.file_sha256 as string | null, fileSize: x.file_size === null ? null : Number(x.file_size),
    validation: x.validation as Validation | null, hasCaptions: !!x.captions_path, captionsBurned: x.captions_burned as boolean,
    captionsSha256: x.captions_sha256 as string | null,
    captionsPreview: Array.isArray(x.captions_preview) ? (x.captions_preview as unknown[]).filter((c): c is string => typeof c === 'string') : [],
    approvedChecksum: x.approved_checksum as string | null, approvedAt: x.approved_at as Date | null,
    makerNote: x.maker_note as string | null, licenceNote: x.licence_note as string | null,
    scheduledFor: x.scheduled_for as Date | null, postedAt: x.posted_at as Date | null, lastError: x.last_error as string | null,
  };
}
