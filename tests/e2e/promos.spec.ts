import { createHash, randomBytes } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { sql } from './helpers/fixtures';

// Promotions (19 November 2026). The preview server runs with ACCOUNTS_ENABLED=true, so the promotions
// surface exists; the seeded "10-Day Spark Streak" record (migration 040) is live, so the public pages render
// it from data. Entry is exercised with a real sign-up + minted sign-in link, the accounts.spec.ts way: the
// emailed link is a row in account_login_tokens, so the spec mints the token the same way the app does.

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const axe = async (page: Page) => {
  await page.waitForFunction(() => document.title.trim().length > 0);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
};
const dobYearsAgo = (years: number) => {
  const d = new Date(Date.now() - 200 * 86_400_000);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};
let n = 0;
const fresh = () => `e2e-promo-${Date.now()}-${n++}@example.test`;

async function signUp(page: Page, email: string, dob: string) {
  await page.goto('/account/sign-up/');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Date of birth').fill(dob);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account\/sign-up\/check-email\/$/);
}

async function signInWithLink(page: Page, email: string) {
  const token = randomBytes(32).toString('hex');
  await sql('INSERT INTO account_login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval \'15 minutes\')', [
    hash(token),
    email,
  ]);
  await page.goto(`/account/sign-in/link/?token=${token}`);
  await page.getByRole('button', { name: 'Continue' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${(n = n + 1) % 250}` });
});

test('the promotions index lists the live Spark Streak from its record', async ({ page }) => {
  await page.goto('/promos/');
  await expect(page.getByRole('heading', { level: 1, name: 'Promotions' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'The 10-Day Spark Streak' })).toBeVisible();
  await expect(page.getByText('Five $25 gift cards drawn every month')).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test('the promo page renders the record: how it works, the rules, and the signed-out pitch', async ({ page }) => {
  await page.goto('/promos/spark-streak/');
  await expect(page.getByRole('heading', { level: 1, name: 'The 10-Day Spark Streak' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The official rules' })).toBeVisible();
  await expect(page.getByText(/18 or older to enter it/)).toBeVisible();
  // Signed out: the pitch and the sign-up path, no entry form.
  await expect(page.getByRole('link', { name: 'Create your free account' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Enter the draw/ })).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
});

test('an adult holder sees their streak and can enter the draw with the attestation', async ({ page }) => {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(30));
  await signInWithLink(page, email);
  await page.goto('/promos/spark-streak/');
  await expect(page.getByText(/Your streak: 0 of 10 days/)).toBeVisible();
  await page.getByLabel(/I confirm I am 18 or older/).check();
  await page.getByRole('button', { name: /Enter the draw/ }).click();
  await expect(page.getByText('You are entered in the draw.')).toBeVisible();
  // The entry is a row now, and the form is gone on a fresh load.
  const rows = await sql('SELECT 1 FROM promo_entries e JOIN accounts a ON a.id = e.account_id WHERE a.email = $1', [email]);
  expect(rows.rows.length).toBe(1);
  await page.goto('/promos/spark-streak/');
  await expect(page.getByRole('button', { name: /Enter the draw/ })).toHaveCount(0);
});

test('the promo pages carry per-record share meta, and the share art is served at 1200x630', async ({ page, request }) => {
  await page.goto('/promos/spark-streak/');
  const meta = async (sel: string) => page.locator(sel).getAttribute('content');
  // The seeded record's share fields drive the tags (migration 041), not the page's own title.
  expect(await meta('meta[property="og:title"]')).toContain('5 × $25 gift cards');
  expect(await meta('meta[property="og:description"]')).toContain('ten days in a row');
  expect(await meta('meta[property="og:image"]')).toContain('/images/promos/share-streak.jpg');
  expect(await meta('meta[property="og:image:width"]')).toBe('1200');
  expect(await meta('meta[property="og:image:height"]')).toBe('630');
  expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/promos\/spark-streak\/$/);

  await page.goto('/promos/');
  expect(await meta('meta[property="og:image"]')).toContain('/images/promos/share-hub.jpg');

  for (const img of ['share-streak.jpg', 'share-hub.jpg']) {
    const res = await request.get(`/images/promos/${img}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/jpeg');
    const body = await res.body();
    expect(body.length).toBeLessThan(300_000); // a share card stays light
    // JPEG SOF0/SOF2 carries the frame size: 1200x630.
    expect(body.indexOf(Buffer.from([0xff, 0xd8]))).toBe(0);
  }
});

test('an ended promotion keeps its page with an ended state — shared links never 404', async ({ page }) => {
  await sql(
    `INSERT INTO promotions (slug, type, title, short_description, body, rules, prize, status)
     VALUES ('ended-promo', 'streak_draw', 'The Finished One', 'It ran its course.', 'How it worked.', 'The rules.', 'A prize', 'ended')`,
  );
  const res = await page.goto('/promos/ended-promo/');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'The Finished One' })).toBeVisible();
  await expect(page.getByText('This promotion has ended')).toBeVisible();
  await expect(page.getByRole('button', { name: /Enter the draw/ })).toHaveCount(0);
  // And it is not listed among the live promotions.
  await page.goto('/promos/');
  await expect(page.getByRole('link', { name: 'The Finished One' })).toHaveCount(0);
});

test('the sitemap lists the promotions hub and the live promos', async ({ request }) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  const xml = await res.text();
  // Preview builds (SITE_RELEASE=false) publish an empty sitemap by design; the entries land on release.
  if (process.env.SITE_RELEASE === 'false') {
    expect(xml).not.toContain('/promos/');
    return;
  }
  expect(xml).toContain('/promos/</loc>');
  expect(xml).toContain('/promos/spark-streak/</loc>');
});

test('a 16-year-old holder can see their streak but is told the draw is for grown-ups', async ({ page }) => {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(16));
  await signInWithLink(page, email);
  await page.goto('/promos/spark-streak/');
  await expect(page.getByText(/The prize draw is for grown-ups/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Enter the draw/ })).toHaveCount(0);
});
