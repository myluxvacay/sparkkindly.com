import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addItem, addTopic, sql } from './helpers/fixtures';
import { BASE } from './helpers/admin';
import { childSession, member } from './helpers/members';

// Save world (plan 2026-11-07 Task 2). Every Save page carries the education-only disclaimer; other worlds do not.
// A Save guide (`all`) never shows a sponsor line, even when its topic is sponsored; a Save offer (`adults`) shows the
// affiliate disclosure to an anonymous visitor and nothing to a 16-year-old; a child profile never reaches the offer on
// the world page, the item page, search or the topic page. The sponsor link is never followed (example.test).

const stamp = Date.now();
const TOPIC = `e2e-save-${stamp}`;
const SPONSOR = `Acme Savings ${stamp}`;
const GUIDE = `e2e-save-guide-${stamp}`;
const OFFER = `e2e-save-offer-${stamp}`;
const GUIDE_TITLE = `How a budget works ${stamp}`;
const OFFER_TITLE = `How this savings offer works ${stamp}`;
const DISCLAIMER = 'General information, not financial advice. Check the details with the provider before you decide.';
const AFFILIATE = 'SparkKindly earns a commission if you buy through this link.';

const axe = async (page: Page) => {
  await page.waitForFunction(() => document.title.trim().length > 0); // the title can stream in after the body
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
};
async function axeBothWidths(page: Page) {
  expect(await axe(page)).toEqual([]);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await axe(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1280, height: 720 });
}

test.beforeAll(async () => {
  await addTopic(TOPIC, 'Save fixture');
  await addItem({ world: 'save', slug: GUIDE, audience: 'all', title: GUIDE_TITLE, topics: [TOPIC] });
  await addItem({ world: 'save', slug: OFFER, audience: 'adults', title: OFFER_TITLE, topics: [TOPIC] });
  const sponsor = await sql(
    `INSERT INTO sponsors (name, link, disclosure, category, confirmed_at)
     VALUES ($1, 'https://acme.example.test/save', '', 'finance-education', now()) RETURNING id`,
    [SPONSOR],
  );
  await sql(
    `INSERT INTO sponsorships (sponsor_id, topic_id, label, kind, ends_on)
     SELECT $1, id, 'See the Acme account', 'affiliate', (now() + interval '7 days')::date FROM topics WHERE slug = $2`,
    [sponsor.rows[0].id, TOPIC],
  );
});
test.afterAll(async () => {
  await sql('DELETE FROM sponsorships WHERE sponsor_id IN (SELECT id FROM sponsors WHERE name = $1)', [SPONSOR]);
  await sql('DELETE FROM sponsors WHERE name = $1', [SPONSOR]);
});

test('the disclaimer is on the Save world page and every Save item, and not on other worlds', async ({ page }) => {
  const thirdParty: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(BASE) && !r.url().startsWith('data:')) thirdParty.push(r.url());
  });
  await page.goto('/save/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Spend smart. Keep more.');
  await expect(page.getByText(DISCLAIMER)).toHaveCount(1);
  await axeBothWidths(page);

  await page.goto(`/save/${GUIDE}/`);
  await expect(page.getByText(DISCLAIMER)).toHaveCount(1);
  await expect(page.locator('.sponsor-line')).toHaveCount(0);
  expect(await page.content()).not.toContain(SPONSOR);
  await axeBothWidths(page);

  await page.goto(`/save/${OFFER}/`);
  await expect(page.getByText(DISCLAIMER)).toHaveCount(1);
  await expect(page.locator('.sponsor-line')).toContainText(AFFILIATE);
  await expect(page.locator('.sponsor-line').getByRole('link', { name: 'See the Acme account' })).toHaveAttribute('rel', 'sponsored noopener noreferrer');
  await axeBothWidths(page);

  for (const path of ['/grow/', '/discover/a-day-in-shadows/', '/kids/']) {
    await page.goto(path);
    await expect(page.getByText(DISCLAIMER), path).toHaveCount(0);
  }
  expect(thirdParty).toEqual([]);
});

test('a 16-year-old sees no sponsor line on the offer; a child profile never reaches it', async ({ browser }) => {
  const teen = await member(browser, 16, `e2e-save-${stamp}`);
  await teen.page.goto(`/save/${OFFER}/`);
  await expect(teen.page.getByRole('heading', { level: 1 })).toHaveText(OFFER_TITLE);
  await expect(teen.page.getByText(DISCLAIMER)).toHaveCount(1);
  expect(await teen.page.content()).not.toContain(SPONSOR);

  const child = await childSession(browser, `e2e-save-child-${stamp}`);
  expect((await child.goto(`/save/${OFFER}/`))!.status()).toBe(404);
  for (const path of ['/save/', `/search/?q=${encodeURIComponent(String(stamp))}`, `/topics/${TOPIC}/`]) {
    await child.goto(path);
    await expect(child.getByRole('link', { name: GUIDE_TITLE }).first(), path).toBeVisible();
    const html = await child.content();
    expect(html, path).not.toContain(OFFER_TITLE);
    expect(html, path).not.toContain(SPONSOR);
  }
});
