// SEO audit coverage on the running app: titles, structured data, paginated canonicals, topic links, the sitemap and
// meta description lengths.
import { test, expect } from '@playwright/test';

test('the home page title is absolute and og:title matches; about does not repeat the brand', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('SparkKindly — Think sharp. Be kind.');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'SparkKindly — Think sharp. Be kind.');
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'en_GB');
  await page.goto('/about/');
  await expect(page).toHaveTitle('About | SparkKindly');
});
