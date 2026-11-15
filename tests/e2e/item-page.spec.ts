import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { addItem, resetExtras } from './helpers/fixtures';

test.beforeEach(resetExtras);
test.afterAll(resetExtras);

const starterArticles = fs
  .readdirSync('content/articles')
  .map((f) => JSON.parse(fs.readFileSync(`content/articles/${f}`, 'utf8')) as { brand: string; slug: string; title: string; reviewStatus: string })
  .filter((a) => a.reviewStatus === 'approved');

test('every approved starter article renders its title from the database', async ({ request }) => {
  test.setTimeout(300_000);
  expect(starterArticles.length).toBeGreaterThan(0);
  // At library scale (800+ articles) a browser sweep outruns the test timeout, so the sweep goes over HTTP:
  // every article page must still answer 200 with its own title as the page heading.
  for (const a of starterArticles) {
    const res = await request.get(`/${a.brand}/${a.slug}/`);
    expect(res.status(), a.slug).toBe(200);
    const html = await res.text();
    // Raw HTML carries React's entity escaping (a title's apostrophe arrives as &#x27;); the browser original
    // compared textContent, which decodes, so decode the standard entities before comparing.
    const h1 = html
      .match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    expect(h1, a.slug).toBe(a.title);
  }
});

test('the starter article keeps its canonical URL and a template og:image', async ({ page }) => {
  await page.goto('/discover/a-day-in-shadows/');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://sparkkindly.com/discover/a-day-in-shadows/');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/api\/template-image\/discover\/a-day-in-shadows\/$/);
  const release = process.env.SITE_RELEASE !== 'false';
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', release ? 'index, follow, max-image-preview:large' : 'noindex, nofollow');
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((d) => JSON.parse(d)['@type']);
  expect(types).toEqual(expect.arrayContaining(['BreadcrumbList', 'Article']));
});

test('markup in a title or paragraph shows as literal text', async ({ page }) => {
  await addItem({
    world: 'discover',
    slug: 'markup-fixture',
    title: '<b>x</b> in the title',
    body: { sections: [{ heading: 'One', paragraphs: ['<b>x</b> in a paragraph'] }, { heading: 'Two', paragraphs: ['Plain.'] }], takeaway: 'T.' },
  });
  await page.goto('/discover/markup-fixture/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('<b>x</b> in the title');
  await expect(page.getByText('<b>x</b> in a paragraph')).toBeVisible();
  await expect(page.locator('article b')).toHaveCount(0);
});

test('the Kids article shows its materials and supervision', async ({ page }) => {
  await page.goto('/kids/shadow-explorers/');
  await expect(page.getByText('Materials:')).toBeVisible();
  await expect(page.getByText('Supervision:')).toBeVisible();
});

test('sources link to their https URL with a safe rel', async ({ page }) => {
  await page.goto('/discover/a-day-in-shadows/');
  const link = page.locator('.source-notes a[href^="https://"]').first();
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('a video_script, a draft, a future item and a once-published archived item are not found', async ({ page }) => {
  await addItem({ world: 'discover', slug: 'fx-script', kind: 'video_script' });
  await addItem({ world: 'discover', slug: 'fx-draft', status: 'draft' });
  await addItem({ world: 'discover', slug: 'fx-future', status: 'scheduled', publishedAt: "now() + interval '1 day'" });
  await addItem({ world: 'discover', slug: 'fx-archived', status: 'archived', publishedAt: "now() - interval '1 day'" });
  for (const slug of ['fx-script', 'fx-draft', 'fx-future', 'fx-archived', 'does-not-exist']) {
    const res = await page.goto(`/discover/${slug}/`);
    expect(res?.status(), slug).toBe(404);
  }
});

test('an adults item renders for an anonymous visitor', async ({ page }) => {
  await addItem({ world: 'grow', slug: 'fx-adults', audience: 'adults', title: 'For grown-ups only fixture' });
  const res = await page.goto('/grow/fx-adults/');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('For grown-ups only fixture');
});

test('every item page ends with a report link to its form', async ({ page }) => {
  await page.goto('/discover/a-day-in-shadows/');
  await expect(page.getByRole('link', { name: /Report a problem/ })).toHaveAttribute('href', '/report/discover/a-day-in-shadows/');
});
