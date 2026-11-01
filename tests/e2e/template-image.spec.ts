import { test, expect } from '@playwright/test';
import { addItem, resetExtras } from './helpers/fixtures';

test.beforeEach(resetExtras);
test.afterAll(resetExtras);

const url = (world: string, slug: string) => `/api/template-image/${world}/${slug}/`;

test('a published item gets a PNG with the cache header', async ({ request }) => {
  await addItem({ world: 'play', slug: 'img-ok', title: 'A published fixture with a rather long title to wrap' });
  const res = await request.get(url('play', 'img-ok'));
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/png');
  expect(res.headers()['cache-control']).toBe('public, max-age=86400');
  const body = await res.body();
  expect([...body.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

test('anything not publicly visible is a 404', async ({ request }) => {
  await addItem({ world: 'play', slug: 'img-draft', status: 'draft' });
  await addItem({ world: 'play', slug: 'img-future', publishedAt: "now() + interval '1 day'" });
  await addItem({ world: 'play', slug: 'img-script', kind: 'video_script' });
  for (const slug of ['img-draft', 'img-future', 'img-script', 'img-missing']) {
    expect((await request.get(url('play', slug))).status(), slug).toBe(404);
  }
});

test('rendering the image makes no request beyond localhost', async ({ page }) => {
  await addItem({ world: 'play', slug: 'img-net' });
  await page.goto('/about/');
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).hostname));
  await page.evaluate(
    (src) =>
      new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image failed'));
        img.src = src;
      }),
    url('play', 'img-net'),
  );
  expect([...hosts].filter((h) => h !== 'localhost' && h !== '127.0.0.1')).toEqual([]);
});
