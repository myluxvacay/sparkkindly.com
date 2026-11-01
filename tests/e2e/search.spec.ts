import { test, expect } from '@playwright/test';
import { addItem, resetExtras } from './helpers/fixtures';

test.beforeEach(resetExtras);
test.afterAll(resetExtras);

const release = process.env.SITE_RELEASE !== 'false';

test('a published title is found and a draft is not; results show no explanation', async ({ page }) => {
  await addItem({ world: 'discover', slug: 'zebra-crossing', title: 'Zebra crossing' });
  await addItem({ world: 'discover', slug: 'zebra-draft', title: 'Zebra draft', status: 'draft' });
  await addItem({
    world: 'play', slug: 'zebra-quiz', kind: 'quiz', title: 'Zebra quiz', summary: 'A quiz summary that is long enough.',
    body: { mechanic: 'true_false', prompt: 'A prompt that is long enough.', difficulty: 'easy' },
    answer: { value: true, explanation: 'Qx hidden explanation marker for the zebra quiz.' },
  });
  await page.goto('/search/?q=zebra');
  await expect(page.getByRole('link', { name: 'Zebra crossing' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Zebra quiz' }).first()).toBeVisible();
  await expect(page.getByText('Zebra draft')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Qx hidden explanation');
});

test('odd and extreme queries never break the page', async ({ page }) => {
  for (const q of ['', '%20%20', 'a%20%26%20%7C%20!%20(', 'x'.repeat(10_000), "'; DROP TABLE items; --"]) {
    expect((await page.goto(`/search/?q=${q}`))?.status(), q.slice(0, 20)).toBe(200);
  }
  for (const p of ['-1', 'abc', '999999']) expect((await page.goto(`/search/?q=zebra&page=${p}`))?.status(), p).toBe(200);
});

test('an empty query shows the form and a hint; a long one says it was shortened', async ({ page }) => {
  await page.goto('/search/');
  await expect(page.getByRole('searchbox')).toBeVisible();
  await expect(page.getByText(/Type a word or two/)).toBeVisible();
  await page.goto(`/search/?q=${'y'.repeat(150)}`);
  await expect(page.getByText(/first 100 characters/)).toBeVisible();
});

test('the search page is noindex', async ({ page }) => {
  await page.goto('/search/?q=zebra');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('keyboard alone searches: type then Enter', async ({ page }) => {
  await addItem({ world: 'discover', slug: 'kb-zebra', title: 'Zebra keyboard fixture' });
  await page.goto('/search/');
  await page.getByRole('searchbox').focus();
  await page.keyboard.type('zebra');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/q=zebra/);
  await expect(page.getByRole('link', { name: 'Zebra keyboard fixture' }).first()).toBeVisible();
});

test('the sitemap lists published items only, and is empty before release', async ({ request }) => {
  await addItem({ world: 'discover', slug: 'sm-published', title: 'Sitemap published' });
  await addItem({ world: 'discover', slug: 'sm-draft', title: 'Sitemap draft', status: 'draft' });
  await addItem({ world: 'discover', slug: 'sm-script', kind: 'video_script' });
  const xml = await (await request.get('/sitemap.xml')).text();
  if (!release) return expect(xml).not.toContain('<url>');
  expect(xml).toContain('/discover/sm-published/');
  expect(xml).not.toContain('sm-draft');
  expect(xml).not.toContain('sm-script');
  expect(xml).not.toContain('/search');
});
