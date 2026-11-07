import { createHash, randomBytes } from 'node:crypto';
import { test, expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addItem, addTopic, sql } from './helpers/fixtures';
import { BASE, session, signInContext } from './helpers/admin';

// Sponsorship (plan 6 Task 2). The preview server on 4173 runs with SPONSORSHIP_ENABLED (and accounts); the server on
// 4174 has no flags. The owner attaches a sponsor to a Grow topic in /admin; an anonymous visitor sees one line on the
// matching adults item; following it is checked without leaving the site (maxRedirects 0), so no test ever requests the
// sponsor's (example.test) address. A child profile, a 16-year-old and the same topic on an `all` or Kids item see nothing.

const OFF = 'http://localhost:4174';
const stamp = Date.now();
const TOPIC = `e2e-sponsor-${stamp}`;
const SPONSOR = `Acme Budget ${stamp}`;
const LINK = 'https://acme.example.test/budget';
const LABEL = 'Plan a budget with Acme';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
let n = 0;

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
const dobYearsAgo = (years: number) => {
  const d = new Date(Date.now() - 200 * 86_400_000);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

async function member(browser: Browser, years: number): Promise<{ page: Page; id: string; token: string }> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${(n = n + 1) % 250}` } });
  const page = await context.newPage();
  const email = `e2e-sponsor-${stamp}-${n++}@example.test`;
  await page.goto('/account/sign-up/');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Date of birth').fill(dobYearsAgo(years));
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  const link = randomBytes(32).toString('hex');
  await sql("INSERT INTO account_login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '15 minutes')", [hash(link), email]);
  await page.goto(`/account/sign-in/link/?token=${link}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/account\//);
  const id = (await sql('SELECT id FROM accounts WHERE email = $1', [email])).rows[0].id as string;
  const token = (await page.context().cookies(BASE)).find((c) => c.name === '__Host-sk_account')!.value;
  return { page, id, token };
}

const ADULTS = `e2e-sponsored-${stamp}`;
const ALL = `e2e-sponsor-all-${stamp}`;
const KIDS = `e2e-sponsor-kids-${stamp}`;

test.beforeAll(async () => {
  await addTopic(TOPIC, 'Money basics');
  await addItem({ world: 'grow', slug: ADULTS, audience: 'adults', title: 'Your first budget', topics: [TOPIC] });
  await addItem({ world: 'grow', slug: ALL, audience: 'all', title: 'Saving together', topics: [TOPIC] });
  await addItem({ world: 'kids', slug: KIDS, audience: 'all', title: 'Piggy banks', topics: [TOPIC] });
});
test.afterAll(async () => {
  await sql('DELETE FROM sponsorships WHERE sponsor_id IN (SELECT id FROM sponsors WHERE name = $1)', [SPONSOR]);
  await sql('DELETE FROM sponsors WHERE name = $1', [SPONSOR]);
});

test('with the flag off the click route and the disclosure page do not exist', async ({ request }) => {
  expect((await request.get(`${OFF}/go/1/`, { maxRedirects: 0 })).status()).toBe(404);
  expect((await request.get(`${OFF}/sponsorship/`)).status()).toBe(404);
});

test('the owner attaches a sponsor to a Grow topic; an adults item shows one line; clicks are counted', async ({ browser, page, request }) => {
  const owner = await browser.newContext();
  await signInContext(owner, await session());
  const admin = await owner.newPage();
  await admin.goto('/admin/sponsors/');
  await admin.getByLabel('Name (up to 80 characters)').fill(SPONSOR);
  await admin.getByLabel('Link (https, a public site)').fill(LINK);
  await admin.getByLabel('Category', { exact: true }).selectOption('finance-education');
  await admin.getByLabel(/not in an excluded category/).check();
  await admin.getByRole('button', { name: 'Save sponsor' }).click();
  await expect(admin.getByRole('status')).toContainText('Sponsor saved');
  await admin.getByLabel('Sponsor', { exact: true }).selectOption({ label: SPONSOR });
  await admin.getByLabel('Attach to').selectOption('topic');
  await admin.getByLabel('Topic, world or item address').fill(TOPIC);
  await admin.getByLabel('Link text (up to 60 characters)').fill(LABEL);
  await admin.getByRole('button', { name: 'Attach sponsorship' }).click();
  await expect(admin.getByRole('status')).toContainText('Sponsorship attached');
  await axeBothWidths(admin);
  const id = (await sql('SELECT s.id FROM sponsorships s JOIN sponsors sp ON sp.id = s.sponsor_id WHERE sp.name = $1', [SPONSOR])).rows[0].id as number;

  const thirdParty: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(BASE) && !r.url().startsWith('data:')) thirdParty.push(r.url());
  });
  await page.goto(`/grow/${ADULTS}/`);
  const line = page.locator('.sponsor-line');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(`This topic is supported by ${SPONSOR}. ${SPONSOR} had no say in what we publish.`);
  const anchor = line.getByRole('link', { name: LABEL });
  await expect(anchor).toHaveAttribute('href', `/go/${id}/`);
  await expect(anchor).toHaveAttribute('rel', 'sponsored noopener noreferrer');
  expect(await page.content()).not.toContain(LINK);
  await axeBothWidths(page);
  expect(thirdParty).toEqual([]);

  const go = await request.get(`/go/${id}/`, { maxRedirects: 0 });
  expect(go.status()).toBe(302);
  expect(go.headers()['location']).toBe(LINK);
  expect(go.headers()['referrer-policy']).toBe('no-referrer');
  expect(go.headers()['cache-control']).toContain('no-store');
  expect(go.headers()['set-cookie']).toBeUndefined();
  await admin.reload();
  await expect(admin.getByTestId(`clicks-${id}`)).toHaveText('1 click');

  await page.goto('/sponsorship/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How sponsorship works.');
  await axeBothWidths(page);
});

test('a child profile, a 16-year-old and the same topic on an all or Kids item see no sponsorship', async ({ browser, page }) => {
  for (const slug of [`grow/${ALL}`, `kids/${KIDS}`]) {
    await page.goto(`/${slug}/`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const html = await page.content();
    expect(html, slug).not.toContain(SPONSOR);
    expect(html, slug).not.toContain('/go/');
  }
  const id = (await sql('SELECT s.id FROM sponsorships s JOIN sponsors sp ON sp.id = s.sponsor_id WHERE sp.name = $1', [SPONSOR])).rows[0]?.id;
  test.skip(!id, 'needs the sponsorship from the previous test');

  const teen = await member(browser, 16);
  await teen.page.goto(`/grow/${ADULTS}/`);
  await expect(teen.page.getByRole('heading', { level: 1 })).toHaveText('Your first budget');
  expect(await teen.page.content()).not.toContain(SPONSOR);
  const teenGo = await teen.page.request.get(`/go/${id}/`, { maxRedirects: 0 });
  expect(teenGo.headers()['location']).toBe('/');

  const parent = await member(browser, 35);
  const kid = (await sql("INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, 'Mo', '6-9') RETURNING id", [parent.id])).rows[0].id;
  await sql('UPDATE account_sessions SET active_profile_id = $1 WHERE token_hash = $2', [kid, hash(parent.token)]);
  const child = await parent.page.goto(`/grow/${ADULTS}/`);
  expect(child!.status()).toBe(404);
  expect(await parent.page.content()).not.toContain(SPONSOR);
  const childGo = await parent.page.request.get(`/go/${id}/`, { maxRedirects: 0 });
  expect(childGo.headers()['location']).toBe('/');
});
