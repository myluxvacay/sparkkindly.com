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

test('a 16-year-old holder can see their streak but is told the draw is for grown-ups', async ({ page }) => {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(16));
  await signInWithLink(page, email);
  await page.goto('/promos/spark-streak/');
  await expect(page.getByText(/The prize draw is for grown-ups/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Enter the draw/ })).toHaveCount(0);
});
