import { test, expect } from '@playwright/test';
import { addItem, sql } from './helpers/fixtures';

// Owner-attached YouTube video (8 November 2026): the article shows a preview and a Play button; nothing is requested
// from YouTube until the press, then the nocookie player appears in place. Kids pages never show one.

const stamp = Date.now();
const SLUG = `e2e-video-${stamp}`;
const KIDS = `e2e-video-kids-${stamp}`;
const ID = 'dQw4w9WgXcQ';
const isYouTube = (u: string) => /(^|\.)(youtube|youtube-nocookie|ytimg|googlevideo)\.com|youtu\.be/.test(new URL(u).hostname);

test.beforeAll(async () => {
  await addItem({ world: 'discover', slug: SLUG, audience: 'all', title: `Video article ${stamp}` });
  await addItem({ world: 'kids', slug: KIDS, audience: 'kids', title: `Kids no video ${stamp}` });
  await sql('UPDATE items SET video_youtube_id = $1 WHERE slug = ANY($2)', [ID, [SLUG, KIDS]]);
});
test.afterAll(async () => {
  await sql('DELETE FROM items WHERE slug = ANY($1)', [[SLUG, KIDS]]);
});

test('preview first; YouTube is requested only after Play', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (isYouTube(r.url())) asked.push(r.url());
  });
  await page.goto(`/discover/${SLUG}/`);
  await expect(page.getByRole('button', { name: /Play video/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Watch on YouTube' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(asked).toEqual([]); // the preview comes from our own /api/video-poster/, fetched server-side
  await expect(page.locator('iframe')).toHaveCount(0);

  await page.getByRole('button', { name: /Play video/ }).click();
  const frame = page.locator('iframe[title^="Video:"]');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('src', new RegExp(`^https://www\.youtube-nocookie\.com/embed/${ID}\?`));
});

test('a Kids item never shows a video, even if the database holds an id', async ({ page }) => {
  await page.goto(`/kids/${KIDS}/`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Play video/ })).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  expect((await page.request.get(`/api/video-poster/kids/${KIDS}/`)).status()).toBe(404);
});

test('the poster route is a 404 for an item with no video', async ({ page }) => {
  expect((await page.request.get('/api/video-poster/discover/no-such-item/')).status()).toBe(404);
});
