import { test, expect } from '@playwright/test';
import { addItem, resetExtras } from './helpers/fixtures';

// "Keep reading" (owner request, 20 Nov 2026): the end-of-article panel offers the next similar
// article plus easier / same / harder choices across the reading bands; the island prefers articles
// this device has not read; and on Kids-audience articles the device read list is never touched
// (the keep-playing child-safety carve-out, applied to reading).
test.beforeEach(resetExtras);
test.afterAll(resetExtras);

const body = { sections: [{ heading: 'One', paragraphs: ['Something short and friendly to read.'] }], takeaway: 'T.' };

test('the panel recommends the same-track sibling and the level buttons navigate', async ({ page }) => {
  await addItem({ world: 'discover', slug: 'kr-easier', topics: ['vocabulary', 'pre-k'], body });
  await addItem({ world: 'discover', slug: 'kr-current', topics: ['phonics', 'grades-k-2'], body });
  await addItem({ world: 'discover', slug: 'kr-sibling', topics: ['phonics', 'grades-k-2'], body });
  await addItem({ world: 'discover', slug: 'kr-harder', topics: ['grammar', 'grades-3-5'], body });

  await page.goto('/discover/kr-current/');
  const panel = page.locator('[data-kr]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-kr-card-title]')).toHaveText('Fixture kr-sibling');
  await expect(panel.locator('[data-kr-btn="next"]')).toHaveAttribute('href', '/discover/kr-sibling/');
  await expect(panel.locator('[data-kr-btn="easier"]')).toHaveAttribute('href', '/discover/kr-easier/');
  await expect(panel.locator('[data-kr-btn="harder"]')).toHaveAttribute('href', '/discover/kr-harder/');

  await panel.locator('[data-kr-btn="harder"]').click();
  await expect(page).toHaveURL('/discover/kr-harder/');
  await expect(page.locator('[data-kr]')).toBeVisible();
});

test('the island deals an unread article once the server’s first pick has been read', async ({ page }) => {
  await addItem({ world: 'discover', slug: 'kr-shelf-a', topics: ['phonics', 'grades-k-2'], body });
  await addItem({ world: 'discover', slug: 'kr-shelf-b', topics: ['phonics', 'grades-k-2'], body });
  await addItem({ world: 'discover', slug: 'kr-start', topics: ['phonics', 'grades-k-2'], body });

  // Reading shelf-a marks it on this device (the panel island runs on its page too).
  await page.goto('/discover/kr-shelf-a/');
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('sk-read-articles')))
    .not.toBeNull();

  // From kr-start, the same-level shelf holds exactly the two shelf articles; the read one is
  // skipped, whichever order the server's rotation dealt them in.
  await page.goto('/discover/kr-start/');
  await expect(page.locator('[data-kr-btn="next"]')).toHaveAttribute('href', '/discover/kr-shelf-b/');
});

test('on a Kids article the panel works but the device read list is never touched', async ({ page }) => {
  await addItem({ world: 'kids', slug: 'kr-kid-one', audience: 'kids', topics: ['phonics', 'pre-k'], body });
  await addItem({ world: 'kids', slug: 'kr-kid-two', audience: 'kids', topics: ['phonics', 'pre-k'], body });

  await page.goto('/kids/kr-kid-one/');
  const panel = page.locator('[data-kr]');
  await expect(panel).toBeVisible();
  // No Start fresh row: there is no device list to reset on a Kids surface.
  await expect(panel.locator('[data-kr-fresh]')).toHaveCount(0);
  // Give the island its chance to (not) write, then check both keys the flow could have used.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.localStorage.getItem('sk-read-articles'))).toBeNull();
  expect(await page.evaluate(() => window.sessionStorage.getItem('sk-read-articles'))).toBeNull();

  await page.goto('/kids/kr-kid-two/');
  await expect(page.locator('[data-kr]')).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('sk-read-articles'))).toBeNull();
});
