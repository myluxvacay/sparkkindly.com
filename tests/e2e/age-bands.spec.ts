import { test, expect } from '@playwright/test';

// The first-visit age-band picker (components/BandPicker.tsx). The suite-wide storageState in
// playwright.config.ts seeds 'sk-age-band' = 'all' so the modal never interrupts the other specs;
// this spec overrides it with EMPTY localStorage to exercise the real first-visit flow.
test.use({ storageState: { cookies: [], origins: [] } });

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
  await expect(page.locator('.band-control')).toContainText('Exploring as: Ages 6–8');

  await page.locator('.band-control').getByRole('button', { name: 'Change' }).click();
  await expect(picker).toBeVisible();
});
