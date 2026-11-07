// Signed-in member sessions for e2e specs that check what a teen, an adult or a child profile sees. Signs up through
// the real form, then signs in with a login token written straight into the e2e database (no email is sent).
import { createHash, randomBytes } from 'node:crypto';
import { expect, type Browser, type Page } from '@playwright/test';
import { sql } from './fixtures';
import { BASE } from './admin';

export const hash = (t: string) => createHash('sha256').update(t).digest('hex');
let n = 0;

export const dobYearsAgo = (years: number) => {
  const d = new Date(Date.now() - 200 * 86_400_000);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

export async function member(browser: Browser, years: number, prefix: string): Promise<{ page: Page; id: string; token: string }> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${(n = n + 1) % 250}` } });
  const page = await context.newPage();
  const email = `${prefix}-${n++}@example.test`;
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

// A parent account whose session has a child profile (6-9) active.
export async function childSession(browser: Browser, prefix: string): Promise<Page> {
  const parent = await member(browser, 35, prefix);
  const kid = (await sql("INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, 'Mo', '6-9') RETURNING id", [parent.id])).rows[0].id;
  await sql('UPDATE account_sessions SET active_profile_id = $1 WHERE token_hash = $2', [kid, hash(parent.token)]);
  return parent.page;
}
