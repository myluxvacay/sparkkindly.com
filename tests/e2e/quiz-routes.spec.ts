import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { addItem, resetExtras } from './helpers/fixtures';

test.beforeEach(resetExtras);
test.afterAll(resetExtras);

const starters = fs
  .readdirSync('content/quizzes')
  .map((f) => JSON.parse(fs.readFileSync(`content/quizzes/${f}`, 'utf8')) as { id: string; brand: string; reviewStatus: string })
  .filter((q) => q.reviewStatus === 'approved');

test('/quiz/ shows the latest quiz with an answer form and canonical to its item page', async ({ page }) => {
  await page.goto('/quiz/');
  await expect(page.getByRole('radio').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Check answer/ })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:\/\/sparkkindly\.com\/[a-z]+\/[a-z0-9-]+\/$/);
});

test('answering from /quiz/ lands on the item page with the verdict', async ({ page }) => {
  await page.goto('/quiz/');
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page.getByRole('status')).toContainText(/Correct|Not quite/);
});

test('the archive links every published starter quiz across its pages', async ({ page }) => {
  const seen = new Set<string>();
  for (let n = 1; n <= 10; n++) {
    await page.goto(`/quiz/archive/?page=${n}`);
    for (const h of await page.locator('main a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))) seen.add(h);
    if ((await page.getByRole('link', { name: /Older/ }).count()) === 0) break;
  }
  for (const q of starters) expect(seen, q.id).toContain(`/${q.brand}/${q.id}/`);
});

test('the archive is newest first and tolerates bad page numbers', async ({ page }) => {
  await addItem({ world: 'play', slug: 'fx-newest-quiz', kind: 'quiz', title: 'Newest fixture quiz', publishedAt: 'now()', body: { mechanic: 'true_false', prompt: 'A prompt that is long enough.', difficulty: 'easy' }, answer: { value: true, explanation: 'An explanation that is long enough.' } });
  await page.goto('/quiz/archive/');
  await expect(page.locator('main h2 a, main h3 a').first()).toHaveText('Newest fixture quiz');
  for (const q of ['-1', 'abc', '999999']) expect((await page.goto(`/quiz/archive/?page=${q}`))?.status(), q).toBe(200);
});

test('an old quiz id redirects permanently to its item page', async ({ request }) => {
  const q = starters[0];
  const res = await request.get(`/quiz/${q.id}/`, { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers()['location']).toMatch(new RegExp(`/${q.brand}/${q.id}/$`));
});

test('an unknown or draft quiz id is not found', async ({ request }) => {
  await addItem({ world: 'play', slug: 'fx-draft-quiz', kind: 'quiz', status: 'draft' });
  for (const id of ['no-such-quiz', 'fx-draft-quiz']) {
    expect((await request.get(`/quiz/${id}/`, { maxRedirects: 0 })).status(), id).toBe(404);
  }
});
