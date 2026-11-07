// Share buttons on item pages (owner request): plain links with the right hosts and the clean canonical URL, the copy
// button announces "Link copied", Kids items show no social-network links, no third-party request on load, axe at 320px
// and desktop, no horizontal scroll, and no answer in any link after answering.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { BASE, watchThirdParty } from './helpers/admin';

const ARTICLE = '/discover/a-day-in-shadows/';
const section = (page: Page) => page.getByRole('region', { name: 'Share this' });
const hrefs = (page: Page) => section(page).locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));

async function axeBothWidths(page: Page) {
  const run = async () =>
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations;
  expect(await run()).toEqual([]);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await run()).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1280, height: 720 });
}

test('an article shows "Share this" with labelled links to the right hosts and the clean canonical URL', async ({ page }) => {
  const thirdParty = watchThirdParty(page);
  await page.goto(`${ARTICLE}?utm_source=instagram`);
  await expect(section(page).getByRole('heading', { level: 2, name: 'Share this' })).toBeVisible();
  const links = await hrefs(page);
  const hosts = links.filter((h) => h.startsWith('https:')).map((h) => new URL(h).host);
  expect(hosts).toEqual(['wa.me', 'www.facebook.com', 'twitter.com', 't.me']);
  expect(links.some((h) => h.startsWith('sms:'))).toBe(true);
  expect(links.some((h) => h.startsWith('mailto:'))).toBe(true);
  for (const h of links) {
    const decoded = decodeURIComponent(h);
    expect(decoded).toContain(`https://sparkkindly.com${ARTICLE}`);
    expect(decoded).not.toContain('utm_');
  }
  for (const a of await section(page).locator('a[href^="https:"]').all()) {
    await expect(a).toHaveAttribute('target', '_blank');
    await expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await axeBothWidths(page);
  expect(thirdParty).toEqual([]);
});

test('Copy link copies the canonical URL and announces "Link copied"', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await page.goto(ARTICLE);
  await section(page).getByRole('button', { name: 'Copy link' }).click();
  await expect(section(page).getByText('Link copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`https://sparkkindly.com${ARTICLE}`);
});

test('a Kids item shows no social-network links and stores nothing', async ({ page }) => {
  const thirdParty = watchThirdParty(page);
  await page.goto('/kids/shadow-explorers/');
  await expect(section(page)).toBeVisible();
  const links = await hrefs(page);
  expect(links.filter((h) => /wa\.me|facebook|twitter|t\.me/.test(h))).toEqual([]);
  await expect(section(page).getByRole('button', { name: 'Copy link' })).toBeVisible();
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  expect(thirdParty).toEqual([]);
});

test('after answering the quiz of the day, no share link carries the answer or result', async ({ page }) => {
  const thirdParty = watchThirdParty(page);
  await page.goto('/quiz/');
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page.getByRole('status')).toBeVisible();
  const result = (await page.getByRole('status').textContent()) ?? '';
  const links = await hrefs(page);
  expect(links.length).toBeGreaterThan(0);
  for (const h of links) {
    const decoded = decodeURIComponent(h);
    if (!h.includes('facebook.com')) expect(decoded).toMatch(/Can you get this one\? /);
    for (const own of decoded.match(/https:\/\/sparkkindly\.com\/\S*/g) ?? []) expect(own, own).not.toContain('?');
    expect(decoded).not.toMatch(/correct|explanation/i);
    if (result.trim()) expect(decoded).not.toContain(result.trim().slice(0, 40));
  }
  await axeBothWidths(page);
  expect(thirdParty).toEqual([]);
});
