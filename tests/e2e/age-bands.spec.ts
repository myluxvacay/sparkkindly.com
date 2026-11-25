import { test, expect } from '@playwright/test';

// The first-visit age-band picker (components/BandPicker.tsx) and the two band controls
// (components/BandControl.tsx: the top strip under the header and the footer one). The
// suite-wide storageState in playwright.config.ts seeds 'sk-age-band' = 'all' so the modal
// never interrupts the other specs; this spec overrides it with EMPTY localStorage to
// exercise the real first-visit flow.
test.use({ storageState: { cookies: [], origins: [] } });

const topControl = (page: import('@playwright/test').Page) => page.locator('.band-strip .band-control');
const footerControl = (page: import('@playwright/test').Page) => page.locator('.footer .band-control');

test('first visit shows the picker; the choice is kept across reload and reopened from the footer', async ({ page }) => {
  const picker = page.getByRole('dialog');
  await page.goto('/');
  // The picker opens via a deferred timer after mount.
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('heading', { name: /Who’s exploring today/ })).toBeVisible();

  await picker.getByRole('button', { name: 'Ages 6–8' }).click();
  await expect(picker).toBeHidden();
  expect(await page.evaluate(() => window.localStorage.getItem('sk-age-band'))).toBe('6-8');

  await page.reload();
  // Give the deferred open-timer its chance to fire: with a band stored it must not.
  await page.waitForTimeout(500);
  await expect(picker).toBeHidden();
  await expect(footerControl(page)).toContainText('Exploring as: Ages 6–8');
  await expect(topControl(page)).toContainText('Exploring as: Ages 6–8');

  await footerControl(page).getByRole('button', { name: 'Change' }).click();
  await expect(picker).toBeVisible();
});

test('the top control invites a pick when no band is set and stays in sync with the footer', async ({ page }) => {
  const picker = page.getByRole('dialog');
  await page.goto('/');
  await expect(picker).toBeVisible();

  // Skipping stores nothing: the top strip must invite a pick, not show a band.
  await picker.getByRole('button', { name: 'Skip for now' }).click();
  await expect(picker).toBeHidden();
  await expect(topControl(page)).toBeVisible();
  await expect(topControl(page)).toContainText('Who’s exploring?');

  // The invitation opens the same picker.
  await topControl(page).getByRole('button', { name: 'Pick an age band' }).click();
  await expect(picker).toBeVisible();

  await picker.getByRole('button', { name: 'Ages 3–5' }).click();
  await expect(picker).toBeHidden();
  expect(await page.evaluate(() => window.localStorage.getItem('sk-age-band'))).toBe('3-5');
  // Both controls reflect the stored band immediately.
  await expect(topControl(page)).toContainText('Exploring as: Ages 3–5');
  await expect(footerControl(page)).toContainText('Exploring as: Ages 3–5');

  // Changing the band from the TOP control updates the footer label too (one shared state).
  await topControl(page).getByRole('button', { name: 'Change' }).click();
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Ages 9–12' }).click();
  await expect(picker).toBeHidden();
  expect(await page.evaluate(() => window.localStorage.getItem('sk-age-band'))).toBe('9-12');
  await expect(topControl(page)).toContainText('Exploring as: Ages 9–12');
  await expect(footerControl(page)).toContainText('Exploring as: Ages 9–12');
});
