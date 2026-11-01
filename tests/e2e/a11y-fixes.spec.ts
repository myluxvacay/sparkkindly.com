import { test, expect, type Page } from '@playwright/test';
import { addItem, addTopic, resetExtras } from './helpers/fixtures';

// Project 1D, Task 1: the accessibility minors the 1B review deferred.
test.beforeEach(resetExtras);
test.afterAll(resetExtras);

const levels = (page: Page) =>
  page.evaluate(() => Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => Number(h.tagName[1])));

// A heading outline is sound when it starts at h1 and never descends by more than one level at a time.
const skipsLevel = (list: number[]) => list.some((n, i) => (i === 0 ? n !== 1 : n - list[i - 1] > 1));

test('after a submitted answer focus is on the result block and the URL names it', async ({ page }) => {
  await page.goto('/play/number-detective-001/');
  await page.getByRole('radio', { name: /30/ }).check();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page).toHaveURL(/#result$/);
  const result = page.locator('#result');
  await expect(result).toBeFocused();
  await expect(result).toHaveAttribute('role', 'status');
});

test('without JavaScript the submitted answer still lands on #result', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://localhost:4173/play/number-detective-001/');
  await page.getByRole('radio', { name: /30/ }).check();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page).toHaveURL(/#result$/);
  await expect(page.locator('#result')).toBeVisible();
  await context.close();
});

test('the report confirmation and error are focused result blocks', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': '10.1.0.1' });
  await page.goto('/report/discover/a-day-in-shadows/');
  await page.getByRole('radio', { name: /broken/ }).check();
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page).toHaveURL(/\?sent=1#result$/);
  await expect(page.locator('#result')).toBeFocused();
  await page.goto('/report/discover/a-day-in-shadows/?error=1#result');
  await expect(page.locator('#result')).toHaveAttribute('role', 'alert');
});

test('the report form has no reason pre-selected and refuses to send without one', async ({ page }) => {
  await page.goto('/report/discover/a-day-in-shadows/');
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page).not.toHaveURL(/sent=1/);
  expect(await page.getByRole('radio').first().evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
});

test('duplicate positions in put_in_order get a specific message', async ({ page }) => {
  await addItem({
    world: 'play', slug: 'fx-order', kind: 'quiz', title: 'Fixture order',
    body: {
      mechanic: 'put_in_order', prompt: 'Put these in order, please.', difficulty: 'easy',
      items: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Bravo' }, { id: 'c', text: 'Charlie' }],
    },
    answer: { value: ['c', 'a', 'b'], explanation: 'Zq explanation marker long enough.' },
  });
  await page.goto('/play/fx-order/?pos-a=1&pos-b=1&pos-c=2');
  await expect(page.locator('#result')).toContainText('different position');
  await expect(page.locator('#result')).not.toContainText('Please choose or enter an answer');
});

test('heading levels never skip on list pages, topic, archive, world, home and item pages', async ({ page }) => {
  await addTopic('e2e-headings', 'E2E headings');
  await addItem({ world: 'discover', slug: 'fx-heading', title: 'Heading fixture', topics: ['e2e-headings'] });
  for (const path of ['/search/?q=shadows', '/topics/e2e-headings/', '/quiz/archive/', '/discover/', '/', '/discover/a-day-in-shadows/']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    expect(skipsLevel(await levels(page)), `${path}: ${(await levels(page)).join(',')}`).toBe(false);
  }
});

test('the breadcrumb marks the current page and the pager landmark is absent when it has no links', async ({ page }) => {
  await page.goto('/discover/a-day-in-shadows/');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).locator('[aria-current="page"]')).toHaveText('A day in shadows');
  await page.goto('/search/?q=shadows');
  await expect(page.getByRole('navigation', { name: 'Pages' })).toHaveCount(0);
});
