import { createHash, randomBytes } from 'node:crypto';
import { test, expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { sql } from './helpers/fixtures';
import { FORM, form } from './helpers/admin';

// Circles (plan 4A Task 3). The preview server on 4173 runs with ACCOUNTS_ENABLED and CIRCLES_ENABLED; the server on
// 4174 has neither, so it covers the flag-off 404s. Only example.test addresses; sign-in links are minted as rows, as
// in accounts.spec.ts. Joining by invite arrives in 4B, so a second member is added as a row.

const OFF = 'http://localhost:4174';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const axe = async (page: Page) => {
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
let n = 0;
const fresh = () => `e2e-circle-${Date.now()}-${n++}@example.test`;

// A verified adult signed in on its own browser context (its own network address for the sign-up limits).
async function adult(browser: Browser): Promise<{ page: Page; email: string; id: string }> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${(n = n + 1) % 250}` } });
  const page = await context.newPage();
  const email = fresh();
  await page.goto('/account/sign-up/');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Date of birth').fill('1988-04-04');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  const token = randomBytes(32).toString('hex');
  await sql("INSERT INTO account_login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '15 minutes')", [hash(token), email]);
  await page.goto(`/account/sign-in/link/?token=${token}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/account\/$/);
  const id = (await sql('SELECT id FROM accounts WHERE email = $1', [email])).rows[0].id as string;
  return { page, email, id };
}

test('with the flag off every circle page and route is a 404 (server without the flags)', async ({ request }) => {
  for (const path of ['/circles/', '/circles/new/', '/circles/abcdefghij/']) {
    expect((await request.get(OFF + path)).status(), path).toBe(404);
  }
  const posts = ['/circles/create/', ...['leave', 'remove', 'transfer', 'close', 'add-child', 'remove-child'].map((a) => `/circles/abcdefghij/${a}/`)];
  for (const path of posts) {
    const r = await request.post(OFF + path, { headers: { ...FORM, origin: OFF }, data: form({ confirm: 'on' }), maxRedirects: 0 });
    expect(r.status(), path).toBe(404);
  }
});

test('an adult creates a family circle and adds a child; a stranger gets a 404; ownership moves; the old owner leaves', async ({ browser }) => {
  const a = await adult(browser);
  await sql("INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, 'Mia', '6-9')", [a.id]);

  await a.page.goto('/account/');
  await a.page.getByRole('link', { name: 'Circles' }).click();
  await expect(a.page.getByRole('heading', { level: 1, name: 'Your circles' })).toBeVisible();
  await expect(a.page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await axeBothWidths(a.page);
  await a.page.getByRole('link', { name: 'Create a circle' }).click();
  await axeBothWidths(a.page);
  await a.page.getByLabel('Circle name').fill('The Rivera Home');
  await a.page.getByRole('radio', { name: /^Family:/ }).check();
  await a.page.getByLabel('Your name in this circle').fill('Mum');
  await a.page.getByRole('button', { name: 'Create the circle' }).click();
  await expect(a.page.getByRole('status')).toContainText('Your circle is ready');
  const slug = /\/circles\/([a-z0-9]{10})\//.exec(a.page.url())![1];

  await a.page.getByLabel('Child profile', { exact: true }).selectOption({ label: 'Mia' });
  await a.page.getByLabel(/everyone in this circle sees this display name/).check();
  await a.page.getByRole('button', { name: 'Add to the circle' }).click();
  await expect(a.page.getByRole('status')).toContainText('The child profile is in the circle');
  await expect(a.page.getByRole('listitem').filter({ hasText: 'Mia (child profile)' })).toBeVisible();
  await expect(a.page.getByText(a.email)).toHaveCount(0);
  await axeBothWidths(a.page);

  const b = await adult(browser);
  expect((await b.page.goto(`/circles/${slug}/`))!.status()).toBe(404);
  await sql(
    "INSERT INTO circle_members (circle_id, account_id, display_name) SELECT id, $2, 'Bea' FROM circles WHERE slug = $1",
    [slug, b.id],
  );
  await b.page.goto(`/circles/${slug}/`);
  await expect(b.page.getByRole('heading', { level: 2, name: 'Owner controls' })).toHaveCount(0);
  const text = (await b.page.content()).toLowerCase();
  expect(text).not.toContain(a.email);
  expect(text).not.toContain(a.id);

  await a.page.goto(`/circles/${slug}/`);
  await a.page.getByLabel('New owner (adult members only)').selectOption({ label: 'Bea' });
  await a.page.getByLabel('Yes, hand over ownership').check();
  await a.page.getByRole('button', { name: 'Transfer ownership' }).click();
  await expect(a.page.getByRole('status')).toContainText('Ownership is handed over');
  await b.page.reload();
  await expect(b.page.getByRole('heading', { level: 2, name: 'Owner controls' })).toBeVisible();

  await a.page.getByRole('button', { name: 'Leave this circle' }).click();
  await expect(a.page).toHaveURL(/\/circles\/\?r=left#result$/);
  await expect(a.page.getByRole('status')).toContainText('You have left the circle');
  expect((await a.page.goto(`/circles/${slug}/`))!.status()).toBe(404);
  await b.page.reload();
  await expect(b.page.getByRole('listitem').filter({ hasText: 'Mum' })).toHaveCount(0);
  await expect(b.page.getByRole('listitem').filter({ hasText: 'Mia' })).toHaveCount(0);
});

test('a cross-site POST is refused and a signed-out POST goes to sign-in', async ({ request }) => {
  const r = await request.post('/circles/create/', {
    headers: { ...FORM, origin: 'https://evil.example' },
    data: form({ name: 'X', kind: 'friends', your_name: 'Y' }),
    maxRedirects: 0,
  });
  expect(r.status()).toBe(403);
  const anon = await request.post('/circles/create/', {
    headers: { ...FORM, origin: 'http://localhost:4173' },
    data: form({ name: 'X', kind: 'friends', your_name: 'Y' }),
    maxRedirects: 0,
  });
  expect([anon.status(), anon.headers().location]).toEqual([303, '/account/sign-in/']);
});
