import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addItem, sql } from './helpers/fixtures';
import { session, signInContext } from './helpers/admin';
import { mp4, vtt } from '../helpers/mp4';
import { generateKey } from '../../lib/agents/keys';
import { runVideoPoster } from '../../lib/social/video/poster';
import { selectVideos } from '../../lib/social/video/select';
import type { Db, Queryable } from '../../lib/db';

// The video jobs queue end to end (plan 5B Task 4). The preview server on 4173 runs with SOCIAL_ENABLED and its media
// folder in the OS temp directory. The daily selection and the poster run here, as the worker would on the VM, the
// poster against injected fake TikTok and YouTube APIs (no request leaves the machine). The promoter's briefs go through
// the real route; the owner uploads a small MP4 (made with ffmpeg when it is installed, so a real ffprobe accepts it)
// and a caption file through the job page, approves, and the posts show with their links. An invalid file is refused,
// unpublishing flags the posted jobs, and a Kids video script never gets a job.

const stamp = Date.now();
const DAY = new Date().toISOString().slice(0, 10);
const MEDIA = path.join(tmpdir(), 'sparkkindly-e2e-media'); // the same folder playwright.config.ts gives the server
const query: Queryable['query'] = async (text, params) => {
  const r = await sql(text, params);
  return { rows: r.rows as never[], rowCount: r.rowCount };
};
// One connection, so a transaction is BEGIN/COMMIT on it (the selection needs one).
const db: Db = {
  query,
  exec: async (text) => {
    await sql(text);
  },
  transaction: async (fn) => {
    await sql('BEGIN');
    try {
      const r = await fn(db);
      await sql('COMMIT');
      return r;
    } catch (err) {
      await sql('ROLLBACK');
      throw err;
    }
  },
};
let itemId = '';
let kidsId = '';
let promoterKey = '';
let tokens = '';

const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
};
async function axeBothWidths(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await axe(page)).toEqual([]);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await axe(page)).toEqual([]);
  const wide = await page.evaluate(() =>
    [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > 321).map((e) => `${e.tagName}.${e.className}:${e.textContent?.slice(0, 40)}`).slice(0, 8),
  );
  expect(wide).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1280, height: 900 });
}

// A real H.264 MP4 when ffmpeg is installed (the server then checks it with ffprobe); else the container-only fixture.
function videoFile(): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), 'sk-e2e-video-'));
  try {
    const out = path.join(dir, 'v.mp4');
    const args = ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=64x64:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', out];
    execFileSync('ffmpeg', args, { stdio: 'pipe', timeout: 30_000 });
    return readFileSync(out);
  } catch {
    return mp4();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const brief = (platform: string) => ({
  narration: 'Three paper shapes sit on a desk. One is not like the others. Can you spot it before the end?',
  shots: ['Three shapes on a desk', 'A hand turns each one over', 'The odd one out is revealed'],
  onScreenText: ['Which one is different?'],
  captions: platform === 'tiktok' ? { tiktok: 'Which shape is the odd one out?' } : { youtube: { title: 'Spot the odd shape', description: 'A short puzzle for curious minds.' } },
  hashtags: ['puzzle', 'curiosity'],
  durationSeconds: 20,
});

function fakePlatforms(sent: string[]): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    sent.push(`${init?.method} ${u.replace(/\?.*$/, '')}`);
    const ok = (data: unknown) => Response.json({ data, error: { code: 'ok' } });
    if (u.endsWith('/post/publish/video/init/')) return ok({ publish_id: `pub_${stamp}`, upload_url: 'https://open-upload.tiktokapis.com/video/?upload_id=1' });
    if (u.startsWith('https://open-upload.tiktokapis.com/')) return new Response(null, { status: 201 });
    if (u.endsWith('/post/publish/status/fetch/')) return ok({ status: 'PUBLISH_COMPLETE' });
    if (u.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
      return new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=S1' } });
    }
    if (u.includes('upload_id=S1')) return Response.json({ id: `e2eYT${stamp % 1000}` });
    if (u.includes('/upload/youtube/v3/captions')) return Response.json({ id: 'cap1' });
    throw new Error(`unexpected request ${u}`);
  }) as typeof fetch;
}

test.beforeAll(async () => {
  process.env.SOCIAL_ENABLED = 'true';
  itemId = await addItem({
    world: 'discover', slug: `e2e-video-${stamp}`, kind: 'video_script', title: 'The odd shape out',
    body: { hook: 'One shape hides a secret', beats: [{ voiceover: 'Look closely', onScreenText: 'Which?', visual: 'Shapes' }], captions: 'Look closely', hashtags: [] },
  });
  kidsId = await addItem({ world: 'kids', slug: `e2e-video-kids-${stamp}`, kind: 'video_script', title: 'Kids shadow video', audience: 'kids' });
  const { key, prefix, hash } = generateKey();
  await sql("INSERT INTO agents (name, key_prefix, key_hash, role) VALUES ($1, $2, $3, 'promoter')", [`e2e-video-promoter-${stamp}`, prefix, hash]);
  promoterKey = key;
  const dir = mkdtempSync(path.join(tmpdir(), 'sk-e2e-tokens-'));
  tokens = path.join(dir, 'tokens.json');
  const later = Date.now() + 24 * 3_600_000;
  writeFileSync(tokens, JSON.stringify({ tiktok: { accessToken: 'e2e-tt', refreshToken: 'r', expiresAt: later }, youtube: { accessToken: 'e2e-yt', refreshToken: 'r', expiresAt: later } }));
  await sql("UPDATE social_platforms SET enabled = true, daily_cap = 10 WHERE platform IN ('tiktok', 'youtube')");
  await sql("DELETE FROM job_runs WHERE job = 'social-select' AND run_key IN ($1, $2)", [`tiktok:${DAY}`, `youtube:${DAY}`]);
});
test.afterAll(async () => {
  await sql("DELETE FROM distributions WHERE platform IN ('tiktok', 'youtube')");
  await sql("UPDATE social_platforms SET enabled = false, daily_cap = 1 WHERE platform IN ('tiktok', 'youtube')");
  rmSync(path.dirname(tokens), { recursive: true, force: true });
  rmSync(MEDIA, { recursive: true, force: true });
});

test('select, brief, upload, approve and post to TikTok and YouTube; invalid file refused; unpublish flags; Kids never', async ({ browser, request }) => {
  const now = new Date();
  for (const p of ['tiktok', 'youtube']) await selectVideos(db, p, DAY, now);
  const jobs = (await sql<{ id: string; platform: string; item_id: string }>('SELECT id, platform, item_id FROM video_jobs WHERE item_id = ANY($1::uuid[]) ORDER BY platform', [[itemId, kidsId]])).rows;
  expect(jobs.map((j) => [j.platform, j.item_id])).toEqual([['tiktok', itemId], ['youtube', itemId]]);

  const queue = await request.get('/api/agent/promotions/', { headers: { 'x-agent-key': promoterKey } });
  const { entries } = (await queue.json()) as { entries: { id: number; version: number; kind: string; platform: string; data: { title: string } }[] };
  expect(entries.map((e) => e.data.title)).not.toContain('Kids shadow video');
  for (const p of ['tiktok', 'youtube']) {
    const e = entries.find((x) => x.kind === 'video_script' && x.platform === p && x.data.title === 'The odd shape out')!;
    const injected = await request.post('/api/agent/promotions/brief/', { headers: { 'x-agent-key': promoterKey }, data: { id: e.id, version: e.version, ...brief(p), narration: 'Visit evil.example now' } });
    expect(injected.status()).toBe(400);
    const r = await request.post('/api/agent/promotions/brief/', { headers: { 'x-agent-key': promoterKey }, data: { id: e.id, version: e.version, ...brief(p) } });
    expect(await r.json()).toEqual({ status: 'brief_ready' });
  }

  const ctx = await browser.newContext();
  await signInContext(ctx, await session());
  const admin = await ctx.newPage();
  await admin.goto('/admin/social/videos/');
  await expect(admin.getByRole('heading', { name: 'Video jobs', level: 1 })).toBeVisible();
  await expect(admin.getByText('Kids shadow video')).toHaveCount(0);
  await axeBothWidths(admin);

  const file = videoFile();
  for (const j of jobs) {
    await admin.goto(`/admin/social/videos/${j.id}/`);
    await expect(admin.getByText('Three paper shapes sit on a desk.', { exact: false })).toBeVisible();
    const videoInput = admin.getByLabel('Finished video (MP4, H.264, up to 128 MB)');
    const videoForm = admin.locator('form').filter({ has: videoInput });
    await videoInput.setInputFiles({ name: 'bad.mp4', mimeType: 'video/mp4', buffer: Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64)]) });
    await videoForm.getByRole('button', { name: 'Upload' }).click();
    await expect(videoForm.getByRole('status')).toContainText('did not pass the checks');
    await videoInput.setInputFiles({ name: 'final.mp4', mimeType: 'video/mp4', buffer: file });
    await videoForm.getByRole('button', { name: 'Upload' }).click();
    await expect(admin.getByText('The last upload passed the checks.')).toBeVisible();
    if (j.platform === 'youtube') {
      const capInput = admin.getByLabel('Caption file (WebVTT or SRT)');
      await capInput.setInputFiles({ name: 'subs.vtt', mimeType: 'text/vtt', buffer: Buffer.from(vtt) });
      await admin.locator('form').filter({ has: capInput }).getByRole('button', { name: 'Upload' }).click();
      await expect(admin.getByText('A caption file is attached.')).toBeVisible();
    } else {
      await admin.getByLabel('I confirm the captions are burned into this video').check();
    }
    await admin.getByLabel('Made by (up to 100 characters)').fill('The owner, in Canva');
    await axeBothWidths(admin);
    await admin.getByRole('button', { name: 'Approve for posting' }).click();
    await expect(admin.getByRole('status').filter({ hasText: 'Video approved' })).toBeVisible();
  }

  const due = (await sql<{ t: Date }>("SELECT max(scheduled_for) AS t FROM distributions WHERE item_id = $1 AND status = 'scheduled'", [itemId])).rows[0].t;
  const sent: string[] = [];
  const env = { SOCIAL_MEDIA_DIR: MEDIA, SOCIAL_TOKEN_FILE: tokens, TIKTOK_CLIENT_KEY: 'k', TIKTOK_CLIENT_SECRET: 's', YOUTUBE_CLIENT_ID: 'i', YOUTUBE_CLIENT_SECRET: 's' };
  const result = await runVideoPoster(db, new Date(new Date(due).getTime() + 1000), { env, fetch: fakePlatforms(sent) });
  expect(result).toMatchObject({ posted: 2, failed: 0, flagged: 0 });
  expect(sent).toContain('POST https://open.tiktokapis.com/v2/post/publish/video/init/');
  expect(sent).toContain('POST https://www.googleapis.com/upload/youtube/v3/captions');

  const yt = jobs.find((j) => j.platform === 'youtube')!;
  await admin.goto(`/admin/social/videos/${yt.id}/`);
  await expect(admin.getByText(/Post status:\s*posted/)).toBeVisible();
  await expect(admin.getByRole('link', { name: 'View the post on YouTube' })).toHaveAttribute('href', `https://www.youtube.com/shorts/e2eYT${stamp % 1000}`);
  await axeBothWidths(admin);

  await admin.goto(`/admin/items/${itemId}/`);
  await admin.getByRole('button', { name: 'Unpublish' }).click();
  await expect(admin.getByRole('status')).toContainText('Unpublished.');
  await admin.goto(`/admin/social/videos/${yt.id}/`);
  await expect(admin.getByText(/Post status:\s*flagged/)).toBeVisible();
  await expect(admin.getByText(/remove manually from the platform/)).toBeVisible();
  await ctx.close();
});

test('media is never served: the upload route has no GET and the media folder is not reachable', async ({ request }) => {
  const r = await request.get('/admin/social/videos/1/upload/');
  expect([404, 405]).toContain(r.status());
  for (const p of ['/media/social/approved/', '/quarantine/', '/opt/sparkkindly/shared/media/social/approved/']) {
    expect((await request.get(p)).status()).toBe(404);
  }
});
