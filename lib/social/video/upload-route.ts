// POST /admin/social/videos/<id>/upload/ (plan 5B): the finished video or its caption file, as the raw request body
// (streamed, never buffered whole). In order, like every admin write: SOCIAL_ENABLED, same Origin, an admin session
// (link + code), the session's CSRF token (X-CSRF header), the job (brief ready, or uploaded and not yet approved),
// then receiveUpload into quarantine, the content checks (validateMp4 or validateCaptions) and, in one transaction, the
// job update with its audit_log row (video.upload / video.captions_upload). A file that fails its checks is deleted
// and the reasons are kept on the job. The response is JSON with a fixed message; it never carries a path or a file.
// No Next.js imports. Verified by tests/unit/social-video-admin.test.tsx.
import { readFile } from 'node:fs/promises';
import { audit } from '@/lib/admin/audit';
import { readCookie, sameOrigin } from '@/lib/admin/guard';
import { checkCsrf, getAdmin } from '@/lib/admin/sessions';
import { socialEnabled } from '@/lib/config';
import type { Db, Queryable } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { validateCaptions } from './captions';
import { ensureDirs, mediaDirs, pathIn, removeFile, type MediaDirs } from './storage';
import { moveVideoJob } from './states';
import { receiveUpload, type UploadCode, type UploadKind } from './upload';
import { validateMp4, type Probe, type Validation } from './validate';

type Deps = { db: Db; env: EnvLike; now: Date; jobId: string; probe?: Probe };

const TEXT = {
  video_uploaded: 'Video uploaded and checked. Review it, then approve it for posting.',
  captions_uploaded: 'Caption file uploaded and checked.',
  invalid: 'The file did not pass the checks: see the validation result on the job.',
  wrong_state: 'This job cannot take a file now (no brief yet, already approved or cancelled).',
  too_large: 'The file is larger than allowed (video 256 MB, captions 200 KB).',
  bad_name: 'Choose an .mp4 video (or a .vtt or .srt caption file) with a plain file name.',
  busy: 'Another upload to this job is still running.',
  quota: 'The upload area is full. Approve or cancel waiting jobs first.',
  size_mismatch: 'The upload was incomplete. Please try again.',
  aborted: 'The upload was interrupted. Please try again.',
  storage: 'The file could not be stored. Please try again later.',
  forbidden: 'Forbidden.',
  signed_out: 'Your admin session has ended. Sign in again.',
  not_found: 'Not found.',
} as const;
type Code = keyof typeof TEXT;
const STATUS: Record<UploadCode, number> = { too_large: 413, bad_name: 400, busy: 409, quota: 507, size_mismatch: 400, aborted: 400, storage: 500 };

const reply = (status: number, code: Code, extra: Record<string, unknown> = {}) =>
  Response.json({ ok: status === 200, code, message: TEXT[code], ...extra }, { status, headers: { 'cache-control': 'no-store' } });

type Job = { state: string; file_name: string | null; captions_path: string | null };
const OPEN = ['brief_ready', 'uploaded'];

async function lockJob(tx: Queryable, id: number): Promise<Job | null> {
  const r = await tx.query<Job>('SELECT state, file_name, captions_path FROM video_jobs WHERE id = $1 FOR UPDATE', [id]);
  return r.rows[0] ?? null;
}

async function storeVideo(d: Deps, admin: string, id: number, dirs: MediaDirs, file: { name: string; sha256: string; size: number }): Promise<Response> {
  const v: Validation = await validateMp4(pathIn(dirs.quarantine, file.name), { probe: d.probe });
  const old = await d.db.transaction(async (tx) => {
    const job = await lockJob(tx, id);
    if (!job || !OPEN.includes(job.state)) return { refused: true as const };
    if (v.ok) {
      await moveVideoJob(tx, id, 'upload', { set: { file_name: file.name, file_sha256: file.sha256, file_size: file.size, validation: JSON.stringify(v) } });
    } else {
      await tx.query('UPDATE video_jobs SET validation = $2::jsonb, updated_at = now() WHERE id = $1', [id, JSON.stringify(v)]);
    }
    await audit(tx, admin, 'video.upload', `video_job:${id}`, { ok: v.ok, sha256: file.sha256, size: file.size });
    return { refused: false as const, previous: v.ok ? job.file_name : null };
  });
  if (old.refused || !v.ok) await removeFile(dirs, file.name);
  else await removeFile(dirs, old.previous);
  if (old.refused) return reply(409, 'wrong_state');
  return v.ok ? reply(200, 'video_uploaded') : reply(422, 'invalid', { errors: v.errors });
}

async function storeCaptions(d: Deps, admin: string, id: number, dirs: MediaDirs, name: string): Promise<Response> {
  const ext = name.endsWith('.srt') ? 'srt' : 'vtt';
  const check = validateCaptions(await readFile(pathIn(dirs.quarantine, name)), ext);
  if (!check.ok) {
    await removeFile(dirs, name);
    return reply(422, 'invalid', { errors: [`caption file refused: ${check.reason}`] });
  }
  const r = await d.db.transaction(async (tx) => {
    const job = await lockJob(tx, id);
    if (!job || !OPEN.includes(job.state)) return null;
    await tx.query('UPDATE video_jobs SET captions_path = $2, updated_at = now() WHERE id = $1', [id, name]);
    await audit(tx, admin, 'video.captions_upload', `video_job:${id}`, {});
    return job;
  });
  await removeFile(dirs, r ? r.captions_path : name);
  return r ? reply(200, 'captions_uploaded') : reply(409, 'wrong_state');
}

export async function handleVideoUpload(request: Request, d: Deps): Promise<Response> {
  if (!socialEnabled()) return reply(404, 'not_found');
  if (!sameOrigin(request)) return reply(403, 'forbidden');
  const token = readCookie(request);
  const admin = await getAdmin(d.db, token, d.env, d.now);
  if (!admin) return reply(401, 'signed_out');
  if (!checkCsrf(token, request.headers.get('x-csrf'))) return reply(403, 'forbidden');
  if (!/^\d{1,12}$/.test(d.jobId)) return reply(404, 'not_found');
  const id = Number(d.jobId);
  const kind = request.headers.get('x-upload-kind') as UploadKind;
  if (kind !== 'video' && kind !== 'captions') return reply(400, 'bad_name');
  const job = await lockJob(d.db, id);
  if (!job) return reply(404, 'not_found');
  if (!OPEN.includes(job.state)) return reply(409, 'wrong_state');
  const dirs = mediaDirs(process.env); // the media folder is the server's setting, never the request's
  await ensureDirs(dirs).catch(() => undefined);
  const declaredSize = Number(request.headers.get('x-declared-size') ?? '');
  let clientName = '';
  try {
    clientName = decodeURIComponent(request.headers.get('x-file-name') ?? ''); // the browser sends it URI-encoded
  } catch {
    return reply(400, 'bad_name');
  }
  const r = await receiveUpload({ body: request.body, declaredSize, clientName, jobId: id, dirs, kind });
  if (!r.ok) return reply(STATUS[r.code], r.code);
  return kind === 'video' ? storeVideo(d, admin.email, id, dirs, r) : storeCaptions(d, admin.email, id, dirs, r.name);
}
