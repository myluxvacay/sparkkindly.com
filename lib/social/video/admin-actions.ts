// The owner's video job actions (plan 5B), merged into lib/admin/actions.ts, which runs each inside one transaction with
// its audit_log row and makes them unknown while SOCIAL_ENABLED is off. (Uploads go through their own streaming route,
// lib/social/video/upload-route.ts.)
// - video.approve: bound to the job version and checksum the owner saw. Refused without validation, without captions
//   (YouTube: a caption file; TikTok: the owner's declaration that captions are burned in), for an item no longer
//   eligible, or when the file on disk no longer hashes to that checksum. The file (and captions) then move to the
//   approved folder, are re-hashed there, and the distribution is scheduled at the platform's time.
// - video.cancel: the job and its distribution (never while posting or once posted); files are purged after 30 days.
// - video.retry: a failed distribution of an approved job, once more.
// No Next.js imports. Verified by tests/unit/social-video-admin.test.tsx.
import type { ErrorCode } from '@/lib/admin/messages';
import type { Queryable } from '@/lib/db';
import { retryDistribution, cancelDistribution } from '../admin';
import { scheduleTime } from '../copy';
import { eligibleItem, videoEligibleWhere } from '../eligibility';
import { moveDistribution, type VideoPlatform } from '../states';
import { approveFiles, findFile, mediaDirs, sha256File } from './storage';
import { moveVideoJob } from './states';

type Ctx = { tx: Queryable; admin: { email: string }; form: URLSearchParams; now: Date };
type Done = { code: 'video_approved' | 'video_cancelled' | 'video_retried'; target: string; detail?: Record<string, unknown> };
type Fail = (status: 400 | 404 | 409, code: ErrorCode) => Error;

type Locked = {
  item_id: string; platform: VideoPlatform; state: string; version: number; file_name: string | null; file_sha256: string | null;
  validation: { ok?: boolean } | null; captions_path: string | null; captions_sha256: string | null; distribution_id: string;
  dstatus: string; post_time_utc: string;
};

async function lockJob(tx: Queryable, f: URLSearchParams, fail: Fail): Promise<Locked & { id: number }> {
  const raw = (f.get('id') ?? '').trim();
  if (!/^\d{1,12}$/.test(raw)) throw fail(400, 'bad_input');
  const r = await tx.query<Locked>(
    `SELECT j.item_id, j.platform, j.state, j.version, j.file_name, j.file_sha256, j.validation, j.captions_path, j.captions_sha256,
            j.distribution_id, d.status AS dstatus, p.post_time_utc::text AS post_time_utc
     FROM video_jobs j JOIN distributions d ON d.id = j.distribution_id JOIN social_platforms p ON p.platform = j.platform
     WHERE j.id = $1 FOR UPDATE OF j, d`,
    [Number(raw)],
  );
  if (!r.rows[0]) throw fail(404, 'not_found');
  return { ...r.rows[0], id: Number(raw) };
}

function note(f: URLSearchParams, name: string, max: number, fail: Fail): string | null {
  const v = (f.get(name) ?? '').trim();
  if ([...v].length > max || /[\p{Cc}]/u.test(v)) throw fail(400, 'bad_input');
  return v || null;
}

// A file still hashing to its checksum, wherever it is now (quarantine before the move, approved after).
async function matches(dirs: ReturnType<typeof mediaDirs>, name: string, checksum: string, where?: 'approved'): Promise<boolean> {
  const found = await findFile(dirs, name);
  return !!found && (!where || found.where === where) && (await sha256File(found.path)) === checksum;
}

// The video and (5B review M2) the caption file are re-hashed before and after the move to approved/.
async function verifiedFiles(j: Locked, checksum: string, fail: Fail): Promise<void> {
  const dirs = mediaDirs(process.env);
  if (!j.file_name || !(await findFile(dirs, j.file_name))) throw fail(409, 'video_missing');
  const files: [string, string][] = [[j.file_name, checksum], ...(j.captions_path ? [[j.captions_path, j.captions_sha256 ?? ''] as [string, string]] : [])];
  for (const [name, sum] of files) if (!(await matches(dirs, name, sum))) throw fail(409, 'video_file_changed');
  await approveFiles(dirs, files.map(([name]) => name));
  for (const [name, sum] of files) if (!(await matches(dirs, name, sum, 'approved'))) throw fail(409, 'video_file_changed');
}

async function approve({ tx, form, now }: Ctx, fail: Fail): Promise<Done> {
  const checksum = (form.get('checksum') ?? '').trim();
  const version = Number(form.get('version'));
  const makerNote = note(form, 'maker_note', 100, fail);
  const licenceNote = note(form, 'licence_note', 200, fail);
  if (!/^[0-9a-f]{64}$/.test(checksum) || !Number.isSafeInteger(version)) throw fail(400, 'bad_input');
  const j = await lockJob(tx, form, fail);
  if (j.state !== 'uploaded') throw fail(409, 'wrong_status');
  // Bound to what the owner saw: the job version, the video's checksum and (5B review M3) the caption file's.
  const captionsChecksum = (form.get('captions_checksum') ?? '').trim();
  if (j.version !== version || j.file_sha256 !== checksum || (j.captions_sha256 ?? '') !== captionsChecksum) throw fail(409, 'changed');
  if (j.validation?.ok !== true) throw fail(409, 'video_invalid');
  const burned = form.get('captions_burned') === 'yes';
  if (j.platform === 'youtube' ? !j.captions_path : !burned) throw fail(409, 'video_captions');
  if (!(await eligibleItem(tx, j.item_id, now, videoEligibleWhere))) throw fail(409, 'social_ineligible');
  await verifiedFiles(j, checksum, fail);
  const set = {
    approved_checksum: checksum, approved_captions_checksum: j.captions_sha256, approved_at: now.toISOString(),
    maker_note: makerNote, licence_note: licenceNote, captions_burned: burned,
  };
  if (!(await moveVideoJob(tx, j.id, 'approve', { version, set }))) throw fail(409, 'changed');
  const at = scheduleTime(j.post_time_utc, now).toISOString();
  if (!(await moveDistribution(tx, Number(j.distribution_id), 'schedule', { set: { scheduled_for: at } }))) throw fail(409, 'wrong_status');
  return { code: 'video_approved', target: `video_job:${j.id}`, detail: { checksum, platform: j.platform } };
}

export function videoHandlers(fail: Fail): Record<string, (c: Ctx) => Promise<Done>> {
  return {
    'video.approve': (c) => approve(c, fail),

    async 'video.cancel'({ tx, form }) {
      const j = await lockJob(tx, form, fail);
      // Never while the worker is uploading it or once the platform has it.
      if (j.dstatus === 'posting' || j.dstatus === 'posted' || !(await moveVideoJob(tx, j.id, 'cancel'))) throw fail(409, 'wrong_status');
      await cancelDistribution(tx, Number(j.distribution_id));
      return { code: 'video_cancelled', target: `video_job:${j.id}` };
    },

    async 'video.retry'({ tx, form, now }) {
      const j = await lockJob(tx, form, fail);
      if (j.state !== 'approved' || !(await retryDistribution(tx, Number(j.distribution_id), now))) throw fail(409, 'wrong_status');
      return { code: 'video_retried', target: `video_job:${j.id}` };
    },
  };
}
