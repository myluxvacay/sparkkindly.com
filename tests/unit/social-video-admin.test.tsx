// @vitest-environment node
// The owner's side of video jobs (plan 5B Task 2) on PGlite and a temp media directory: the streaming upload route
// (same origin, admin session with its second factor, CSRF header, job state, audit), validation recorded on the job,
// captions, the checksum-bound approval (refused without captions or the burned-in declaration, refused when the file
// changed after the owner opened the page or on disk), cancel and retry, the maker note, the purge of cancelled jobs'
// files after 30 days, no public route serving the media folder, and the job page rendering the brief as plain text.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { newTestDb } from '../helpers/test-db';
import { distribution, socialItem } from '../helpers/social';
import { mp4, vtt } from '../helpers/mp4';
import { seedReference } from '@/db/seed';
import { runAction } from '@/lib/admin/actions';
import { newTotpSecret, totpAt } from '@/lib/admin/totp';
import { sealSecret, TEST_SECRET_KEY } from '@/lib/admin/secret-box';
import { consumeLink, csrfToken, requestLink, submitCode } from '@/lib/admin/sessions';
import { handleVideoUpload } from '@/lib/social/video/upload-route';
import { videoJob } from '@/lib/social/video/admin';
import { ensureDirs, mediaDirs, newName } from '@/lib/social/video/storage';
import { purgeCancelledMedia } from '@/lib/jobs/video-purge';
import VideoJobView from '@/components/admin/VideoJob';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let session: string;
let root: string;
const NOW = new Date('2026-11-05T09:00:00Z');
const OWNER = 'owner@example.test';
const env = { ADMIN_EMAILS: OWNER, ADMIN_SECRET_KEY: TEST_SECRET_KEY };
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const noProbe = async () => null;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const secret = newTotpSecret();
  await db.query('INSERT INTO admin_users (email, totp_secret) VALUES ($1, $2)', [OWNER, sealSecret(secret, OWNER, env)]);
  const first = (await consumeLink(db, (await requestLink(db, OWNER, env, NOW))!, env, NOW))!;
  session = (await submitCode(db, first, totpAt(secret, Math.floor(NOW.getTime() / 30_000)), env, NOW)).session!;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'sk-video-admin-'));
  vi.stubEnv('SOCIAL_ENABLED', 'true');
  vi.stubEnv('SOCIAL_MEDIA_DIR', root);
  await ensureDirs(mediaDirs({ SOCIAL_MEDIA_DIR: root }));
  await db.query('DELETE FROM distributions');
  await db.query("UPDATE social_platforms SET enabled = true, post_time_utc = '15:00'");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

const brief = {
  narration: 'Three shapes look alike. <img src=x onerror=alert(1)>',
  shots: ['Shot one', 'Shot two', 'Shot three'],
  onScreenText: ['Which one?'],
  captions: { tiktok: 'Guess the odd one out' },
  hashtags: ['puzzle'],
  durationSeconds: 30,
  assets: { logo: '/brand/sparkkindly-logo.png', worldColour: '#e8b54a', frames: ['title-card', 'end-card'] },
};

async function job(platform: 'tiktok' | 'youtube' = 'tiktok', state = 'brief_ready') {
  const item = await socialItem(db, { kind: 'video_script', title: 'Odd one out' });
  const d = await distribution(db, item, platform, { status: 'copy_ready', caption: 'Guess the odd one out' });
  const r = await db.query<{ id: string }>(
    'INSERT INTO video_jobs (item_id, platform, distribution_id, state, brief) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id',
    [item, platform, d, state, JSON.stringify(brief)],
  );
  return { id: Number(r.rows[0].id), item, distribution: d };
}

function uploadReq(id: number, body: Buffer, o: { kind?: string; name?: string; csrf?: string; cookie?: string | null; origin?: string; size?: number } = {}) {
  const headers: Record<string, string> = {
    host: 'sparkkindly.com',
    origin: o.origin ?? 'https://sparkkindly.com',
    'content-type': 'application/octet-stream',
    'x-csrf': o.csrf ?? csrfToken(session),
    'x-upload-kind': o.kind ?? 'video',
    'x-file-name': o.name ?? 'final.mp4',
    'x-declared-size': String(o.size ?? body.length),
  };
  if (o.cookie !== null) headers.cookie = `__Host-sk_admin=${o.cookie ?? session}`;
  return new Request(`http://localhost/admin/social/videos/${id}/upload/`, { method: 'POST', headers, body: new Uint8Array(body) });
}
const send = (req: Request, id: number) => handleVideoUpload(req, { db, env, now: NOW, jobId: String(id), probe: noProbe });
const jobRow = async (id: number) =>
  (
    await db.query<{ state: string; version: number; file_name: string | null; file_sha256: string | null; file_size: string | null; validation: { ok: boolean; errors: string[] } | null; captions_path: string | null; captions_sha256: string | null; approved_captions_checksum: string | null; approved_checksum: string | null; maker_note: string | null; dstatus: string; scheduled_for: Date | null }>(
      `SELECT j.state, j.version, j.file_name, j.file_sha256, j.file_size, j.validation, j.captions_path, j.captions_sha256, j.approved_captions_checksum, j.approved_checksum, j.maker_note,
              d.status AS dstatus, d.scheduled_for FROM video_jobs j JOIN distributions d ON d.id = j.distribution_id WHERE j.id = $1`,
      [id],
    )
  ).rows[0];
const audits = async (action: string) => (await db.query('SELECT target FROM audit_log WHERE action = $1', [action])).rows;
const act = (name: string, fields: Record<string, string>) => runAction(db, { email: OWNER }, name, new URLSearchParams(fields), NOW);

async function uploaded(platform: 'tiktok' | 'youtube' = 'tiktok') {
  const j = await job(platform);
  expect((await send(uploadReq(j.id, mp4()), j.id)).status).toBe(200);
  return j;
}

describe('the upload route', () => {
  it('stores a valid file: job uploaded with the server name, checksum, size and validation; audited', async () => {
    const j = await job();
    const b = mp4();
    const r = await send(uploadReq(j.id, b, { name: '../../evil name.mp4' }), j.id);
    // the client name had a path in it: refused before anything is read
    expect(r.status).toBe(400);
    const ok = await send(uploadReq(j.id, b), j.id);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, code: 'video_uploaded' });
    const row = await jobRow(j.id);
    expect(row).toMatchObject({ state: 'uploaded', file_sha256: sha(b), validation: { ok: true } });
    expect(Number(row.file_size)).toBe(b.length);
    expect(row.file_name).toMatch(new RegExp(`^${j.id}-[0-9a-f]{32}\\.mp4$`));
    expect(readdirSync(path.join(root, 'quarantine'))).toEqual([row.file_name]);
    expect(await audits('video.upload')).toEqual([{ target: `video_job:${j.id}` }]);
  });

  it('refuses a foreign origin, no session, a wrong CSRF token, an unknown job and a job still waiting for its brief', async () => {
    const j = await job();
    expect((await send(uploadReq(j.id, mp4(), { origin: 'https://evil.example' }), j.id)).status).toBe(403);
    expect((await send(uploadReq(j.id, mp4(), { cookie: null }), j.id)).status).toBe(401);
    expect((await send(uploadReq(j.id, mp4(), { cookie: 'f'.repeat(64) }), j.id)).status).toBe(401);
    expect((await send(uploadReq(j.id, mp4(), { csrf: 'wrong' }), j.id)).status).toBe(403);
    expect((await send(uploadReq(999999, mp4()), 999999)).status).toBe(404);
    expect((await send(uploadReq(j.id, mp4()), Number.NaN)).status).toBe(404);
    const pending = await job('tiktok', 'brief_pending');
    expect((await send(uploadReq(pending.id, mp4()), pending.id)).status).toBe(409);
    expect(readdirSync(path.join(root, 'quarantine'))).toEqual([]);
    vi.stubEnv('SOCIAL_ENABLED', '');
    expect((await send(uploadReq(j.id, mp4()), j.id)).status).toBe(404);
  });

  it('an invalid file is refused and deleted; the job keeps its state and shows the errors', async () => {
    const j = await job();
    const r = await send(uploadReq(j.id, mp4({ trailing: Buffer.from('junk after the boxes') })), j.id);
    expect(r.status).toBe(422);
    expect(await jobRow(j.id)).toMatchObject({ state: 'brief_ready', file_name: null, validation: { ok: false } });
    expect(readdirSync(path.join(root, 'quarantine'))).toEqual([]);
  });

  it('a replacement before approval deletes the previous file; captions are stored on the job', async () => {
    const j = await uploaded();
    const first = (await jobRow(j.id)).file_name!;
    expect((await send(uploadReq(j.id, mp4({ mdatBytes: 99 })), j.id)).status).toBe(200);
    const second = (await jobRow(j.id)).file_name!;
    expect(second).not.toBe(first);
    const c = await send(uploadReq(j.id, Buffer.from(vtt), { kind: 'captions', name: 'subs.vtt' }), j.id);
    expect(c.status).toBe(200);
    expect((await jobRow(j.id)).captions_path).toMatch(/\.vtt$/);
    expect(readdirSync(path.join(root, 'quarantine')).sort()).toEqual([second, (await jobRow(j.id)).captions_path].sort());
    expect(await audits('video.captions_upload')).toHaveLength(1);
    const bad = await send(uploadReq(j.id, Buffer.from('<script>x</script>'), { kind: 'captions', name: 'subs.vtt' }), j.id);
    expect(bad.status).toBe(422);
  });

  it('5B review L3: an invalid upload after a valid one keeps the valid file and its validation', async () => {
    const j = await uploaded();
    const before = await jobRow(j.id);
    expect((await send(uploadReq(j.id, mp4({ codec: 'hvc1' })), j.id)).status).toBe(422);
    expect(await jobRow(j.id)).toMatchObject({ state: 'uploaded', file_name: before.file_name, validation: { ok: true } });
    expect(readdirSync(path.join(root, 'quarantine'))).toEqual([before.file_name]);
  });

  it('5B review M4: the video limit defaults to 128 MB and follows SOCIAL_MAX_VIDEO_MB up to 256', async () => {
    const j = await job();
    const declared = 130 * 1024 * 1024;
    expect((await send(uploadReq(j.id, Buffer.alloc(4), { size: declared }), j.id)).status).toBe(413);
    vi.stubEnv('SOCIAL_MAX_VIDEO_MB', '200');
    expect((await send(uploadReq(j.id, Buffer.alloc(4), { size: declared }), j.id)).status).not.toBe(413);
    vi.stubEnv('SOCIAL_MAX_VIDEO_MB', '9999');
    expect((await send(uploadReq(j.id, Buffer.alloc(4), { size: 257 * 1024 * 1024 }), j.id)).status).toBe(413);
  });

  it('5B review M3: the job page shows the caption checksum and the first cues as text', async () => {
    const j = await uploaded('youtube');
    await send(uploadReq(j.id, Buffer.from(vtt), { kind: 'captions', name: 'subs.vtt' }), j.id);
    const view = await videoJob(db, j.id);
    const html = renderToStaticMarkup(<VideoJobView csrf="CSRF" job={view!} />);
    expect(html).toContain((await jobRow(j.id)).captions_sha256!);
    expect(html).toContain('Three shapes look alike.');
    expect(html).not.toContain('<v Narrator>');
  });
});

describe('approval', () => {
  const approve = async (id: number, extra: Record<string, string> = {}) => {
    const r = await jobRow(id);
    const caps: Record<string, string> = r.captions_sha256 ? { captions_checksum: r.captions_sha256 } : {};
    return act('video.approve', { id: String(id), version: String(r.version), checksum: r.file_sha256 ?? '', ...caps, ...extra });
  };

  it('5B review M3: a caption upload bumps the version, so an approval from the page opened before it is refused', async () => {
    const j = await uploaded('youtube');
    const opened = await jobRow(j.id);
    await send(uploadReq(j.id, Buffer.from(vtt), { kind: 'captions', name: 'subs.vtt' }), j.id);
    const now = await jobRow(j.id);
    expect(now.version).toBe(opened.version + 1);
    const stale = await act('video.approve', { id: String(j.id), version: String(opened.version), checksum: opened.file_sha256!, captions_checksum: now.captions_sha256! });
    expect(stale).toMatchObject({ ok: false, code: 'changed' });
    const wrongCaptions = await act('video.approve', { id: String(j.id), version: String(now.version), checksum: now.file_sha256!, captions_checksum: 'a'.repeat(64) });
    expect(wrongCaptions).toMatchObject({ ok: false, code: 'changed' });
    expect(await approve(j.id)).toMatchObject({ ok: true });
    expect((await jobRow(j.id)).approved_captions_checksum).toBe(now.captions_sha256);
  });

  it('5B review M3: caption cues are checked like captions (links, blocked words) and refused with the reason', async () => {
    const j = await uploaded('youtube');
    const bad = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nGo to evil.example now\n';
    const r = await send(uploadReq(j.id, Buffer.from(bad), { kind: 'captions', name: 'subs.vtt' }), j.id);
    expect(r.status).toBe(422);
    expect(JSON.stringify(await r.json())).toMatch(/link/);
    expect((await jobRow(j.id)).captions_path).toBeNull();
  });

  it('TikTok: refused without the burned-in captions declaration; approved with it, file moved and re-hashed, scheduled', async () => {
    const j = await uploaded('tiktok');
    expect(await approve(j.id)).toMatchObject({ ok: false, code: 'video_captions' });
    const r = await approve(j.id, { captions_burned: 'yes', maker_note: 'Made by the owner in Canva' });
    expect(r).toMatchObject({ ok: true, code: 'video_approved' });
    const row = await jobRow(j.id);
    expect(row).toMatchObject({ state: 'approved', approved_checksum: row.file_sha256, maker_note: 'Made by the owner in Canva', dstatus: 'scheduled' });
    expect(row.scheduled_for?.toISOString()).toBe('2026-11-05T15:00:00.000Z');
    expect(readdirSync(path.join(root, 'quarantine'))).toEqual([]);
    expect(sha(readFileSync(path.join(root, 'approved', row.file_name!)))).toBe(row.file_sha256);
    expect(await audits('video.approve')).toContainEqual({ target: `video_job:${j.id}` });
  });

  it('YouTube: refused without a caption file', async () => {
    const j = await uploaded('youtube');
    expect(await approve(j.id)).toMatchObject({ ok: false, code: 'video_captions' });
    await send(uploadReq(j.id, Buffer.from(vtt), { kind: 'captions', name: 'subs.vtt' }), j.id);
    expect(await approve(j.id)).toMatchObject({ ok: true });
    const row = await jobRow(j.id);
    expect(existsSync(path.join(root, 'approved', row.captions_path!))).toBe(true);
  });

  it('is bound to the checksum shown: a file replaced after the owner opened the page is refused', async () => {
    const j = await uploaded('tiktok');
    const opened = await jobRow(j.id);
    await send(uploadReq(j.id, mp4({ mdatBytes: 200 })), j.id);
    const r = await act('video.approve', { id: String(j.id), version: String(opened.version), checksum: opened.file_sha256!, captions_burned: 'yes' });
    expect(r).toMatchObject({ ok: false, code: 'changed' });
    expect((await jobRow(j.id)).state).toBe('uploaded');
  });

  it('a file changed on disk since the upload is refused', async () => {
    const j = await uploaded('tiktok');
    writeFileSync(path.join(root, 'quarantine', (await jobRow(j.id)).file_name!), mp4({ mdatBytes: 5 }));
    expect(await approve(j.id, { captions_burned: 'yes' })).toMatchObject({ ok: false, code: 'video_file_changed' });
    expect((await jobRow(j.id)).state).toBe('uploaded');
  });

  it('an item no longer eligible (Kids) cannot be approved', async () => {
    const j = await uploaded('tiktok');
    await db.query("UPDATE items SET audience = 'kids' WHERE id = $1", [j.item]);
    expect(await approve(j.id, { captions_burned: 'yes' })).toMatchObject({ ok: false, code: 'social_ineligible' });
  });

  it('refuses a maker note over 100 characters', async () => {
    const j = await uploaded('tiktok');
    expect(await approve(j.id, { captions_burned: 'yes', maker_note: 'x'.repeat(101) })).toMatchObject({ ok: false, code: 'bad_input' });
  });

  it('video actions are unknown with SOCIAL_ENABLED off', async () => {
    const j = await uploaded('tiktok');
    vi.stubEnv('SOCIAL_ENABLED', '');
    expect(await approve(j.id, { captions_burned: 'yes' })).toMatchObject({ ok: false, code: 'unknown_action' });
  });
});

describe('cancel and retry', () => {
  it('5B review L6: cancelling a video row from /admin/social/ also cancels its job', async () => {
    const j = await uploaded('tiktok');
    expect(await act('social.cancel', { id: String(j.distribution) })).toMatchObject({ ok: true });
    expect(await jobRow(j.id)).toMatchObject({ state: 'cancelled', dstatus: 'cancelled' });
  });

  it('cancel moves the job and its distribution to cancelled; never while posting or once posted', async () => {
    const j = await uploaded('tiktok');
    expect(await act('video.cancel', { id: String(j.id) })).toMatchObject({ ok: true, code: 'video_cancelled' });
    expect(await jobRow(j.id)).toMatchObject({ state: 'cancelled', dstatus: 'cancelled' });
    const k = await uploaded('tiktok');
    await db.query("UPDATE distributions SET status = 'posted' WHERE id = $1", [k.distribution]);
    expect(await act('video.cancel', { id: String(k.id) })).toMatchObject({ ok: false, code: 'wrong_status' });
  });

  it('retry reschedules a failed approved job once more', async () => {
    const j = await uploaded('tiktok');
    await act('video.approve', { id: String(j.id), version: String((await jobRow(j.id)).version), checksum: (await jobRow(j.id)).file_sha256!, captions_burned: 'yes' });
    await db.query("UPDATE distributions SET status = 'failed' WHERE id = $1", [j.distribution]);
    expect(await act('video.retry', { id: String(j.id) })).toMatchObject({ ok: true, code: 'video_retried' });
    expect((await jobRow(j.id)).dstatus).toBe('scheduled');
    expect(await act('video.retry', { id: String(j.id) })).toMatchObject({ ok: false, code: 'wrong_status' });
  });
});

describe('purgeCancelledMedia', () => {
  it('deletes the files of jobs cancelled more than 30 days ago, and only those', async () => {
    const dirs = mediaDirs({ SOCIAL_MEDIA_DIR: root });
    const old = await job();
    const recent = await job();
    const names = [newName(old.id, 'mp4'), newName(recent.id, 'mp4')];
    writeFileSync(path.join(dirs.approved, names[0]), 'x');
    writeFileSync(path.join(dirs.quarantine, names[1]), 'x');
    await db.query("UPDATE video_jobs SET state = 'cancelled', file_name = $2, updated_at = '2026-09-01' WHERE id = $1", [old.id, names[0]]);
    await db.query("UPDATE video_jobs SET state = 'cancelled', file_name = $2, updated_at = '2026-11-01' WHERE id = $1", [recent.id, names[1]]);
    expect(await purgeCancelledMedia(db, dirs, NOW)).toBe(1);
    expect(existsSync(path.join(dirs.approved, names[0]))).toBe(false);
    expect(existsSync(path.join(dirs.quarantine, names[1]))).toBe(true);
    expect((await jobRow(old.id)).file_name).toBeNull();
  });
});

describe('media is never public', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

  it('no route or page reads the media folder; only the upload route writes it, and it never sends a file back', () => {
    const touching = walk('app').filter((f) => /mediaDirs|SOCIAL_MEDIA_DIR|video\/storage|createReadStream/.test(readFileSync(f, 'utf8')));
    expect(touching.map((f) => f.replace(/\\/g, '/'))).toEqual([]);
    const route = readFileSync('app/admin/social/videos/[id]/upload/route.ts', 'utf8');
    expect(route).not.toMatch(/export (async )?function GET/);
    expect(readFileSync('next.config.ts', 'utf8')).not.toMatch(/media/);
    expect(mediaDirs({}).root.replace(/\\/g, '/')).not.toMatch(/public/);
  });
});

describe('the job page', () => {
  it('renders the brief as plain text, the checksum and validation, and the caption rules plainly', async () => {
    const j = await uploaded('youtube');
    const view = await videoJob(db, j.id);
    const html = renderToStaticMarkup(<VideoJobView csrf="CSRF" job={view!} />);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain(view!.fileSha256!);
    expect(html).toMatch(/caption file/i);
    expect(html).not.toMatch(/quarantine|\/opt\/sparkkindly/);
  });
});
