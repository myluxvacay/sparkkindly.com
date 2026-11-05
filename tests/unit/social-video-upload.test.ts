// @vitest-environment node
// Video upload hardening (plan 5B Task 2) in a temp directory: the streaming limit enforced mid-stream (an oversize body
// aborts and leaves no file), aborted uploads clean up, the client file name and path are ignored (server-generated
// names only), double extensions and wrong magic bytes refused, an MP4 header with trailing junk (a polyglot) refused,
// symlinks and traversal refused, SHA-256 recorded and re-verified after the move, concurrent uploads to one job
// serialised, the quarantine quota, the captions checks and the purge (only quarantine files older than 7 days, files
// of jobs cancelled 30 days ago).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync, symlinkSync, utimesSync, existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mp4, srt, streamOf, vtt } from '../helpers/mp4';
import { approveFiles, ensureDirs, findFile, mediaDirs, newName, pathIn, sha256File, type MediaDirs } from '@/lib/social/video/storage';
import { maxVideoBytes, receiveUpload } from '@/lib/social/video/upload';
import { acquireLock } from '@/lib/social/lockfile';
import { validateMp4 } from '@/lib/social/video/validate';
import { validateCaptions } from '@/lib/social/video/captions';
import { purgeQuarantine } from '@/lib/jobs/video-purge';

let root: string;
let dirs: MediaDirs;
beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'sk-video-'));
  dirs = mediaDirs({ SOCIAL_MEDIA_DIR: root });
  await ensureDirs(dirs);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const files = (dir: string) => readdirSync(dir);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const upload = (body: ReadableStream<Uint8Array> | null, declaredSize: number, o: Partial<Parameters<typeof receiveUpload>[0]> = {}) =>
  receiveUpload({ body, declaredSize, clientName: 'my video.mp4', jobId: 7, dirs, kind: 'video', ...o });

describe('storage', () => {
  it('defaults under /opt/sparkkindly/shared/media/ and is configurable; quarantine and approved inside it', () => {
    expect(mediaDirs({}).root.replace(/\\/g, '/')).toMatch(/^\/opt\/sparkkindly\/shared\/media\//);
    expect(dirs.quarantine).toBe(path.join(root, 'quarantine'));
    expect(dirs.approved).toBe(path.join(root, 'approved'));
  });

  it('names are server-generated; any other name (traversal, separators) is refused', () => {
    expect(newName(7, 'mp4')).toMatch(/^7-[0-9a-f]{32}\.mp4$/);
    for (const bad of ['../x.mp4', '7-..%2f.mp4', '/etc/passwd', '7-abc.mp4', `7-${'a'.repeat(32)}.mp4/../../x`, `7-${'a'.repeat(32)}.php`]) {
      expect(() => pathIn(dirs.quarantine, bad), bad).toThrow();
    }
  });
});

describe('receiveUpload', () => {
  it('streams a valid file into quarantine under a server name, with SHA-256 and size; the client name is ignored', async () => {
    const b = mp4();
    const r = await upload(streamOf([b.subarray(0, 10), b.subarray(10)]), b.length, { clientName: 'holiday (final).mp4' });
    expect(r).toMatchObject({ ok: true, sha256: sha(b), size: b.length });
    if (!r.ok) return;
    expect(r.name).toMatch(/^7-[0-9a-f]{32}\.mp4$/);
    expect(files(dirs.quarantine)).toEqual([r.name]);
    expect(readFileSync(path.join(dirs.quarantine, r.name)).equals(b)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(path.join(dirs.quarantine, r.name)).mode & 0o077).toBe(0); // 0600
  });

  it('refuses a declared size over the limit before reading, and aborts an oversize stream mid-way leaving no file', async () => {
    const pulled = vi.fn();
    const body = new ReadableStream({ pull: (c) => { pulled(); c.enqueue(new Uint8Array(1024)); } }, { highWaterMark: 0 });
    expect(await upload(body, 300 * 1024 * 1024)).toEqual({ ok: false, code: 'too_large' });
    expect(pulled).not.toHaveBeenCalled();
    // Declares 100 bytes, sends forever: stopped at the declared size, nothing left behind.
    const endless = new ReadableStream({ pull: (c) => c.enqueue(new Uint8Array(64)) });
    expect(await upload(endless, 100)).toEqual({ ok: false, code: 'too_large' });
    expect(await upload(streamOf([Buffer.alloc(600)]), 1000, { limit: 500 })).toEqual({ ok: false, code: 'too_large' });
    expect(files(dirs.quarantine)).toEqual([]);
  });

  it('a body shorter than declared, or an aborted stream, leaves no file', async () => {
    expect(await upload(streamOf([Buffer.alloc(10)]), 100)).toEqual({ ok: false, code: 'size_mismatch' });
    expect(await upload(streamOf([Buffer.alloc(10)], true), 100)).toEqual({ ok: false, code: 'aborted' });
    expect(await upload(null, 100)).toEqual({ ok: false, code: 'aborted' });
    expect(files(dirs.quarantine)).toEqual([]);
  });

  it.each(['clip.php.mp4', 'clip.mp4.exe', '../../clip.mp4', 'a/b.mp4', 'a\\b.mp4', 'clip.MOV', 'clip', '.mp4', 'clip.mp4\u0000.txt'])(
    'refuses the client name %j before reading',
    async (clientName) => {
      expect(await upload(streamOf([mp4()]), mp4().length, { clientName })).toEqual({ ok: false, code: 'bad_name' });
      expect(files(dirs.quarantine)).toEqual([]);
    },
  );

  it('serialises concurrent uploads to one job: the second is refused as busy while the first streams', async () => {
    const b = mp4();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let sent = false;
    const slow = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (sent) return c.close();
        await gate;
        sent = true;
        c.enqueue(new Uint8Array(b));
      },
    });
    const first = upload(slow, b.length);
    await new Promise((r) => setTimeout(r, 20));
    expect(await upload(streamOf([b]), b.length)).toEqual({ ok: false, code: 'busy' });
    release();
    expect((await first).ok).toBe(true);
    expect((await upload(streamOf([b]), b.length)).ok).toBe(true); // the lock is released afterwards
  });

  it('5B review L2: refuses when free disk space is under twice the declared size plus 1 GB', async () => {
    const b = mp4();
    const low = async () => 1024 * 1024 * 1024 + 2 * b.length - 1;
    expect(await upload(streamOf([b]), b.length, { freeBytes: low })).toEqual({ ok: false, code: 'disk' });
    expect((await upload(streamOf([b]), b.length, { freeBytes: async () => 5 * 1024 ** 3 })).ok).toBe(true);
  });

  it('5B review M4: maxVideoBytes defaults to 128 MB, follows SOCIAL_MAX_VIDEO_MB, never above 256 MB', () => {
    expect(maxVideoBytes({})).toBe(128 * 1024 * 1024);
    expect(maxVideoBytes({ SOCIAL_MAX_VIDEO_MB: '200' })).toBe(200 * 1024 * 1024);
    expect(maxVideoBytes({ SOCIAL_MAX_VIDEO_MB: '900' })).toBe(256 * 1024 * 1024);
    expect(maxVideoBytes({ SOCIAL_MAX_VIDEO_MB: 'abc' })).toBe(128 * 1024 * 1024);
  });

  it('5B review L1: a lock is released only by its holder (a nonce), never one taken over meanwhile', async () => {
    const p = path.join(dirs.quarantine, 'x.lock');
    const release = await acquireLock(p, 60_000);
    expect(release).not.toBeNull();
    expect(await acquireLock(p, 60_000)).toBeNull(); // held
    writeFileSync(p, 'someone-else'); // a stale-lock takeover by another process
    await release!();
    expect(existsSync(p)).toBe(true);
    rmSync(p);
    const again = await acquireLock(p, 60_000);
    await again!();
    expect(existsSync(p)).toBe(false);
  });

  it('enforces the global quarantine quota', async () => {
    writeFileSync(path.join(dirs.quarantine, newName(1, 'mp4')), Buffer.alloc(900));
    expect(await upload(streamOf([mp4()]), mp4().length, { quota: 1000 })).toEqual({ ok: false, code: 'quota' });
  });

  it('a symlinked quarantine directory is refused', async () => {
    const other = mkdtempSync(path.join(tmpdir(), 'sk-elsewhere-'));
    try {
      rmSync(dirs.quarantine, { recursive: true });
      try {
        symlinkSync(other, dirs.quarantine, 'junction');
      } catch {
        return; // no permission to create links here: nothing to test
      }
      expect(await upload(streamOf([mp4()]), mp4().length)).toEqual({ ok: false, code: 'storage' });
      expect(files(other)).toEqual([]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('captions: .vtt or .srt only, up to 200 KB', async () => {
    const b = Buffer.from(vtt);
    const r = await upload(streamOf([b]), b.length, { kind: 'captions', clientName: 'subs.vtt' });
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.name).toMatch(/^7-[0-9a-f]{32}\.vtt$/);
    expect(await upload(streamOf([b]), 300 * 1024, { kind: 'captions', clientName: 'subs.vtt' })).toEqual({ ok: false, code: 'too_large' });
    expect(await upload(streamOf([b]), b.length, { kind: 'captions', clientName: 'subs.mp4' })).toEqual({ ok: false, code: 'bad_name' });
  });
});

describe('validateMp4', () => {
  const write = (b: Buffer) => {
    const p = path.join(dirs.quarantine, newName(9, 'mp4'));
    writeFileSync(p, b);
    return p;
  };

  it('accepts an H.264 MP4 by its content; without ffprobe it says so in a warning', async () => {
    const v = await validateMp4(write(mp4()), { probe: async () => null });
    expect(v).toMatchObject({ ok: true, errors: [] });
    expect(v.warnings.join(' ')).toMatch(/ffprobe/);
  });

  it('uses ffprobe when present: duration and resolution recorded; not H.264 or too long refused', async () => {
    const ok = await validateMp4(write(mp4()), { probe: async () => ({ codec: 'h264', duration: 30.2, width: 1080, height: 1920 }) });
    expect(ok).toMatchObject({ ok: true, durationSeconds: 30.2, width: 1080, height: 1920, warnings: [] });
    expect((await validateMp4(write(mp4()), { probe: async () => ({ codec: 'hevc', duration: 30, width: 1080, height: 1920 }) })).ok).toBe(false);
    expect((await validateMp4(write(mp4()), { probe: async () => ({ codec: 'h264', duration: 200, width: 1080, height: 1920 }) })).ok).toBe(false);
  });

  it.each([
    ['wrong magic bytes (a PNG)', Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(100)])],
    ['a script renamed .mp4', Buffer.from('<?php system($_GET["c"]); ?>'.repeat(4))],
    ['an MP4 header followed by other content (polyglot)', mp4({ trailing: Buffer.from('PK\u0003\u0004 a zip file follows') })],
    ['a QuickTime brand', mp4({ brand: 'qt  ' })],
    ['not H.264 (HEVC)', mp4({ codec: 'hvc1' })],
    ['an empty file', Buffer.alloc(0)],
    ['a box claiming more bytes than the file', Buffer.concat([mp4().subarray(0, 40), Buffer.from([0xff, 0xff, 0xff, 0xff])])],
  ])('refuses %s', async (_, b) => {
    const v = await validateMp4(write(b), { probe: async () => null });
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });
});

describe('validateCaptions', () => {
  it('accepts WebVTT (with a BOM and voice tags) and SRT', () => {
    expect(validateCaptions(Buffer.from(vtt), 'vtt')).toEqual({ ok: true, cues: ['Three shapes look alike.', 'One hides a secret.'] });
    expect(validateCaptions(Buffer.from('﻿' + vtt), 'vtt')).toMatchObject({ ok: true });
    expect(validateCaptions(Buffer.from(srt), 'srt')).toMatchObject({ ok: true });
  });

  it.each([
    ['vtt', 'not a caption file at all'],
    ['vtt', 'WEBVTT\n\nno cues here'],
    ['srt', vtt],
    ['vtt', vtt + '<script>alert(1)</script>'],
    ['vtt', vtt.replace('alike', 'al\u0000ike')],
    ['vtt', 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n' + 'x'.repeat(205 * 1024)],
  ] as const)('refuses a bad %s file', (ext, text) => {
    expect(validateCaptions(Buffer.from(text), ext).ok).toBe(false);
  });

  it('refuses bytes that are not UTF-8', () => {
    expect(validateCaptions(Buffer.concat([Buffer.from('WEBVTT\n\n'), Buffer.from([0xc3, 0x28])]), 'vtt').ok).toBe(false);
  });
});

describe('approveFiles and re-hash', () => {
  it('moves the file to the approved folder atomically; the re-read hash matches; a missing file is refused', async () => {
    const b = mp4();
    const r = await upload(streamOf([b]), b.length);
    if (!r.ok) throw new Error('upload');
    await approveFiles(dirs, [r.name]);
    expect(files(dirs.quarantine)).toEqual([]);
    const found = await findFile(dirs, r.name);
    expect(found?.where).toBe('approved');
    expect(await sha256File(found!.path)).toBe(sha(b));
    await approveFiles(dirs, [r.name]); // already moved (a retried approval): fine
    await expect(approveFiles(dirs, [newName(7, 'mp4')])).rejects.toThrow();
  });
});

describe('purgeQuarantine', () => {
  it('removes only quarantine files older than 7 days (and stray partial files), never approved ones', async () => {
    const NOW = new Date('2026-11-20T00:00:00Z');
    const old = path.join(dirs.quarantine, newName(1, 'mp4'));
    const fresh = path.join(dirs.quarantine, newName(2, 'mp4'));
    const approvedOld = path.join(dirs.approved, newName(3, 'mp4'));
    for (const p of [old, fresh, approvedOld]) writeFileSync(p, 'x');
    const eightDays = new Date(NOW.getTime() - 8 * 86_400_000);
    utimesSync(old, eightDays, eightDays);
    utimesSync(approvedOld, eightDays, eightDays);
    utimesSync(fresh, new Date(NOW.getTime() - 6 * 86_400_000), new Date(NOW.getTime() - 6 * 86_400_000));
    expect(await purgeQuarantine(dirs, NOW)).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(approvedOld)).toBe(true);
  });
});
