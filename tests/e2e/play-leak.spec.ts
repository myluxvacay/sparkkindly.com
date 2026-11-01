import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import { addItem, resetExtras } from './helpers/fixtures';

test.beforeEach(resetExtras);
test.afterAll(resetExtras);

const opts = [{ id: 'a', text: 'Alpha option' }, { id: 'b', text: 'Bravo option' }, { id: 'c', text: 'Charlie option' }, { id: 'd', text: 'Delta option' }];
const base = { prompt: 'A prompt that is long enough to be valid.', difficulty: 'easy' };

// One fixture per mechanic. `secret` is text that must not appear before the answer is submitted; `right` and `wrong`
// are query strings for a correct and an incorrect response.
const fixtures = [
  { slug: 'fx-mc', mechanic: 'multiple_choice', extra: { options: opts }, value: 'b', right: 'r=b', wrong: 'r=a', secret: [] as string[] },
  { slug: 'fx-tf', mechanic: 'true_false', extra: {}, value: true, right: 'r=true', wrong: 'r=false', secret: [] },
  { slug: 'fx-text', mechanic: 'short_text', extra: {}, value: { accepted: ['quokka'] }, right: 'r=Quokka', wrong: 'r=emu', secret: ['quokka'] },
  { slug: 'fx-num', mechanic: 'number', extra: {}, value: { value: 4242, tolerance: 0 }, right: 'r=4242', wrong: 'r=7', secret: ['4242'] },
  { slug: 'fx-odd', mechanic: 'odd_one_out', extra: { items: opts }, value: 'c', right: 'r=c', wrong: 'r=a', secret: [] },
  {
    slug: 'fx-order', mechanic: 'put_in_order', extra: { items: opts.slice(0, 3) }, value: ['c', 'a', 'b'],
    right: 'pos-c=1&pos-a=2&pos-b=3', wrong: 'pos-a=1&pos-b=2&pos-c=3', secret: [],
  },
  {
    slug: 'fx-clue', mechanic: 'clue_reveal', extra: { clues: ['Clue one here', 'Clue two here', 'Clue three here'] },
    value: { accepted: ['okapi'] }, right: 'r=okapi&clues=3', wrong: 'r=zebra&clues=1', secret: ['okapi'],
  },
];
const explanationFor = (slug: string) => `Zq explanation marker for ${slug} that is long enough.`;

async function addFixtures() {
  for (const f of fixtures) {
    await addItem({
      world: 'play', slug: f.slug, kind: 'quiz', title: `Fixture ${f.slug}`,
      body: { mechanic: f.mechanic, ...base, ...f.extra }, answer: { value: f.value, explanation: explanationFor(f.slug) },
    });
  }
}

const starterQuizzes = fs
  .readdirSync('content/quizzes')
  .map((f) => JSON.parse(fs.readFileSync(`content/quizzes/${f}`, 'utf8')) as { id: string; brand: string; explanation: string; reviewStatus: string })
  .filter((q) => q.reviewStatus === 'approved');

test('before answering, no page text, meta tag or payload carries the answer', async ({ request }) => {
  await addFixtures();
  for (const f of fixtures) {
    const html = await (await request.get(`/play/${f.slug}/`)).text();
    for (const s of [explanationFor(f.slug), 'Zq explanation', 'correct', ...f.secret]) expect(html, `${f.slug}: ${s}`).not.toContain(s);
  }
  for (const q of starterQuizzes) {
    const res = await request.get(`/${q.brand}/${q.id}/`);
    expect(res.status(), q.id).toBe(200);
    const html = await res.text();
    const marker = q.explanation.split(/['"&<>]/)[0].slice(0, 40);
    expect(html, q.id).not.toContain(marker);
    // A starter quiz's own option text may say "correctly", so look for the verdict wording and the answer key instead.
    for (const s of ['Correct', 'Not quite', 'correctOptionId', '"correct"']) expect(html, `${q.id}: ${s}`).not.toContain(s);
  }
});

test('a right response shows Correct and the explanation; a wrong one shows Not quite, the answer and the explanation', async ({ page }) => {
  await addFixtures();
  for (const f of fixtures) {
    await page.goto(`/play/${f.slug}/?${f.right}`);
    const status = page.getByRole('status');
    await expect(status, f.slug).toContainText('Correct');
    await expect(status, f.slug).toContainText(explanationFor(f.slug));
    await page.goto(`/play/${f.slug}/?${f.wrong}`);
    await expect(status, f.slug).toContainText('Not quite');
    await expect(status, f.slug).toContainText(explanationFor(f.slug));
    await expect(status, f.slug).toContainText('Answer:');
  }
});

test('a missing or malformed response asks for an answer and reveals nothing', async ({ page }) => {
  await addFixtures();
  await page.goto('/play/fx-text/?r=');
  await expect(page.getByRole('status')).toContainText('Please');
  await expect(page.locator('body')).not.toContainText('quokka');
  await page.goto('/play/fx-order/?pos-a=1&pos-b=1&pos-c=2');
  await expect(page.getByRole('status')).toContainText('Please');
  await expect(page.locator('body')).not.toContainText('Zq explanation');
});

test('clue_reveal shows the first clues and a link to show another', async ({ page }) => {
  await addFixtures();
  await page.goto('/play/fx-clue/');
  await expect(page.getByText('Clue one here')).toBeVisible();
  await expect(page.getByText('Clue two here')).toHaveCount(0);
  await page.getByRole('link', { name: 'Show another clue' }).click();
  await expect(page.getByText('Clue two here')).toBeVisible();
  await expect(page).toHaveURL(/clues=2/);
});

test('keyboard alone completes a multiple-choice item', async ({ page }) => {
  await addFixtures();
  await page.goto('/play/fx-mc/');
  await page.getByRole('radio').first().focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /Check answer/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Not quite');
  await page.getByRole('link', { name: 'Try another' }).focus();
  await expect(page.getByRole('link', { name: 'Try another' })).toBeFocused();
});

test('without JavaScript a starter quiz can be answered', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: 'http://localhost:4173' });
  const page = await context.newPage();
  await page.goto('/play/number-detective-001/');
  await page.getByRole('radio', { name: /30/ }).check();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page.getByRole('status')).toContainText('Correct');
  await expect(page.getByRole('status')).toContainText(/The terms are 1×2/);
  await context.close();
});

test('axe finds no serious or critical issue on an article, an unanswered quiz or an answered quiz', async ({ page }) => {
  for (const path of ['/discover/a-day-in-shadows/', '/play/number-detective-001/', '/play/number-detective-001/?r=c']) {
    await page.goto(path);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'), path).toEqual([]);
  }
});
