// SEO audit coverage on the running app: titles, structured data, paginated canonicals, topic links, the sitemap and
// meta description lengths.
import { test, expect } from '@playwright/test';
import { addItem, addTopic } from './helpers/fixtures';

const stamp = Date.now();
const TOPIC = `seo-topic-${stamp}`;
const TOPIC_NAME = `Seo fixture topic ${stamp}`;
let topicReady = false;
// 13 old articles on one fixture topic: two topic pages, sorted after every other item.
async function topicFixture() {
  if (topicReady) return;
  await addTopic(TOPIC, TOPIC_NAME);
  for (let i = 0; i < 13; i++) {
    await addItem({ world: 'grow', slug: `${TOPIC}-${i}`, title: `Seo fixture ${i}`, topics: [TOPIC], publishedAt: `'2020-01-01T00:00:${String(10 + i)}Z'` });
  }
  topicReady = true;
}

test('the home page title is absolute and og:title matches; about does not repeat the brand', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('SparkKindly — Think sharp. Be kind.');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'SparkKindly — Think sharp. Be kind.');
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'en_GB');
  await page.goto('/about/');
  await expect(page).toHaveTitle('About | SparkKindly');
});

const ldOf = async (page: import('@playwright/test').Page) =>
  (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t) as Record<string, unknown>);

test('the home page carries WebSite and Organization JSON-LD as valid JSON', async ({ page }) => {
  await page.goto('/');
  const data = await ldOf(page);
  expect(data.find((d) => d['@type'] === 'WebSite')).toMatchObject({ name: 'SparkKindly', url: 'https://sparkkindly.com/' });
  expect(data.find((d) => d['@type'] === 'Organization')).toMatchObject({
    name: 'SparkKindly',
    url: 'https://sparkkindly.com/',
    logo: 'https://sparkkindly.com/brand/icon-512.png',
  });
});

test('an article carries publisher, author, dateModified and the article time metas', async ({ page }) => {
  await page.goto('/discover/a-day-in-shadows/');
  const article = (await ldOf(page)).find((d) => d['@type'] === 'Article')!;
  expect(article.publisher).toMatchObject({ '@type': 'Organization', logo: 'https://sparkkindly.com/brand/icon-512.png' });
  expect(article.author).toMatchObject({ name: expect.any(String) });
  expect(article.dateModified).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(Array.isArray(article.image)).toBe(true);
  await expect(page.locator('meta[property="article:published_time"]')).toHaveAttribute('content', /^\d{4}-/);
  await expect(page.locator('meta[property="article:modified_time"]')).toHaveAttribute('content', /^\d{4}-/);
});

test('paginated listings: self-referencing canonical with only ?page=N, and 404 past the end', async ({ page }) => {
  await topicFixture();
  await page.goto(`/topics/${TOPIC}/?utm_source=x`);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://sparkkindly.com/topics/${TOPIC}/`);
  await page.goto(`/topics/${TOPIC}/?page=2&utm_source=x`);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://sparkkindly.com/topics/${TOPIC}/?page=2`);
  expect((await page.goto(`/topics/${TOPIC}/?page=3`))?.status()).toBe(404);
  await page.goto('/grow/?page=2');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://sparkkindly.com/grow/?page=2');
  await page.goto('/quiz/archive/?page=1&x=1');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://sparkkindly.com/quiz/archive/');
});

test('an item page links its own topics; /topics/ lists every topic with counts and is in the footer', async ({ page }) => {
  await topicFixture();
  await page.goto(`/grow/${TOPIC}-0/`);
  const chips = page.getByRole('navigation', { name: 'Topics' });
  await expect(chips.getByRole('link', { name: TOPIC_NAME })).toHaveAttribute('href', `/topics/${TOPIC}/`);
  await expect(chips.getByRole('link')).toHaveCount(1);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Topics' }).click();
  await expect(page).toHaveURL(/\/topics\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: `${TOPIC_NAME} (13)` })).toHaveAttribute('href', `/topics/${TOPIC}/`);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://sparkkindly.com/topics/');
  const description = await page.locator('meta[name="description"]').getAttribute('content');
  expect(description!.length).toBeGreaterThanOrEqual(70);
  expect(description!.length).toBeLessThanOrEqual(160);
  const topicPage = await page.goto(`/topics/${TOPIC}/`);
  expect(topicPage?.status()).toBe(200);
  const topicDescription = await page.locator('meta[name="description"]').getAttribute('content');
  expect(topicDescription).toContain(TOPIC_NAME);
  expect(topicDescription).toContain('13');
});

test('trust pages have 70-160 character descriptions', async ({ page }) => {
  for (const path of ['/about/', '/editorial-policy/', '/accessibility/', '/privacy/', '/terms/', '/contact/', '/community/guidelines/', '/contributors/terms/', '/sponsorship/']) {
    await page.goto(path);
    const d = (await page.locator('meta[name="description"]').getAttribute('content')) ?? '';
    expect(d.length, path).toBeGreaterThanOrEqual(70);
    expect(d.length, path).toBeLessThanOrEqual(160);
  }
});

test('the sitemap lists /topics/ on a released build', async ({ request }) => {
  const body = await (await request.get('/sitemap.xml')).text();
  if (process.env.SITE_RELEASE === 'false') expect(body).not.toContain('/topics/');
  else expect(body).toContain('https://sparkkindly.com/topics/');
});
