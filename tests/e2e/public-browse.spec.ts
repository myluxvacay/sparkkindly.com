import { test, expect } from '@playwright/test';
import { addItem, addTopic, addWorld, resetExtras, setWorldEnabled } from './helpers/fixtures';

test.beforeEach(resetExtras);
test.afterAll(resetExtras);

test('home lists the five worlds and shows a new database item without a rebuild', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  for (const w of ['Play', 'Discover', 'Together', 'Grow', 'Kids']) {
    await expect(page.locator('.world-grid').getByRole('heading', { name: w, exact: true })).toBeVisible();
  }
  await addItem({ world: 'discover', slug: 'home-fixture', title: 'Fresh from the database' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Fresh from the database' })).toBeVisible();
  await page.goto('/discover/');
  await expect(page.getByRole('link', { name: 'Fresh from the database' }).first()).toBeVisible();
});

test('a world with no items shows an empty state', async ({ page }) => {
  await addWorld('e2e-empty', 'Empty fixture');
  await page.goto('/e2e-empty/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('A fixture promise.');
  await expect(page.getByText('Our first pieces are being reviewed')).toBeVisible();
});

test('bad page numbers never break a world page', async ({ page }) => {
  for (const q of ['-1', 'abc', '999999', '0', '2.5']) {
    const res = await page.goto(`/discover/?page=${q}`);
    expect(res?.status(), q).toBe(200);
  }
  await page.goto('/discover/?page=999999');
  await expect(page.getByRole('link', { name: 'Back to the first page' })).toBeVisible();
});

test('a disabled world is gone from the header and 404s', async ({ page }) => {
  await setWorldEnabled('grow', false);
  const res = await page.goto('/grow/');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Grow', exact: true })).toHaveCount(0);
});

test('a topic page lists only items with that topic', async ({ page }) => {
  await addTopic('e2e-owls', 'Owls');
  await addItem({ world: 'discover', slug: 'with-topic', title: 'Has the owl topic', topics: ['e2e-owls'] });
  await addItem({ world: 'discover', slug: 'without-topic', title: 'Has no topic at all' });
  await page.goto('/topics/e2e-owls/');
  await expect(page.getByRole('link', { name: 'Has the owl topic' }).first()).toBeVisible();
  await expect(page.getByText('Has no topic at all')).toHaveCount(0);
  expect((await page.goto('/topics/e2e-missing/'))?.status()).toBe(404);
});

test('long titles and summaries do not overflow at 320px', async ({ page }) => {
  await addItem({ world: 'discover', slug: 'long-one', title: 'W'.repeat(40) + ' ' + 'long title '.repeat(9), summary: 'Summary words '.repeat(21).slice(0, 300) });
  await page.setViewportSize({ width: 320, height: 800 });
  for (const path of ['/', '/discover/']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test('with the database unreachable the page is a generic 500 that leaks nothing', async ({ request }) => {
  const res = await request.get('http://localhost:4174/discover/');
  expect(res.status()).toBe(500);
  const body = (await res.text()).toLowerCase();
  for (const leak of ['econnrefused', 'postgres', '127.0.0.1']) expect(body).not.toContain(leak);
});
