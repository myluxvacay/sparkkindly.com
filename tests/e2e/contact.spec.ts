import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { sql } from './helpers/fixtures';

// The e2e database is shared by the suite, so each test uses its own client address (X-Forwarded-For) to keep its
// rate-limit bucket separate, and counts rows by a unique message. CONTACT_EMAIL is unset in the e2e environment,
// so submissions are stored without any owner email being attempted.
const PAGE = '/contact/';
const POST = '/contact/submit/';
const form = (message: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({ name: 'E2E Tester', email: 'tester@example.com', topic: 'general', message, website: '', ...extra }).toString();
const headers = (ip: string) => ({ 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip });

async function rowsWith(message: string): Promise<number> {
  const r = await sql<{ n: number }>('SELECT count(*)::int AS n FROM contact_messages WHERE message = $1', [message]);
  return r.rows[0].n;
}

test('the form submits, stores a row and confirms with a status message', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': '10.1.0.1' });
  await page.goto(PAGE);
  await page.getByLabel(/Your name/).fill('E2E Tester');
  await page.getByLabel(/email address/).fill('tester@example.com');
  await page.getByLabel(/What is it about/).selectOption('suggest');
  await page.getByLabel(/Your message/).fill('e2e: a topic idea for the Grow world');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page).toHaveURL(/\?sent=1#result$/);
  await expect(page.getByRole('status')).toContainText('Thanks — we read everything');
  expect(await rowsWith('e2e: a topic idea for the Grow world')).toBe(1);
});

test('the form is completable by keyboard and passes axe', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': '10.1.0.2' });
  await page.goto(PAGE);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'), JSON.stringify(result.violations)).toEqual([]);
  await page.getByLabel(/email address/).fill('tester@example.com');
  await page.getByLabel(/Your message/).fill('e2e: keyboard only');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  expect(await rowsWith('e2e: keyboard only')).toBe(1);
});

test('works without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, extraHTTPHeaders: { 'x-forwarded-for': '10.1.0.3' } });
  const page = await context.newPage();
  await page.goto(`http://localhost:4173${PAGE}`);
  await page.getByLabel(/email address/).fill('tester@example.com');
  await page.getByLabel(/Your message/).fill('e2e: no javascript');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  expect(await rowsWith('e2e: no javascript')).toBe(1);
  await context.close();
});

test('an invalid submission comes back with an error and stores nothing', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': '10.1.0.4' });
  await page.goto(PAGE);
  await page.getByLabel(/email address/).fill('tester@example.com');
  await page.getByLabel(/Your message/).fill('e2e: has <markup> in it');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page).toHaveURL(/\?error=1#result$/);
  await expect(page.locator('#result')).toContainText('was not sent');
  expect(await rowsWith('e2e: has <markup> in it')).toBe(0);
});

test('a POST with a foreign Origin is refused and stores nothing', async ({ request }) => {
  const res = await request.post(POST, { headers: { ...headers('10.1.0.5'), origin: 'https://evil.example' }, data: form('e2e: foreign origin'), maxRedirects: 0 });
  expect(res.status()).toBe(403);
  expect(await rowsWith('e2e: foreign origin')).toBe(0);
});

test('a filled honeypot redirects as if stored but writes nothing', async ({ request }) => {
  const res = await request.post(POST, { headers: headers('10.1.0.6'), data: form('e2e: honeypot', { website: 'x' }), maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers().location).toBe(`${PAGE}?sent=1#result`);
  expect(await rowsWith('e2e: honeypot')).toBe(0);
});

test('the sixth rapid POST from one client is 429 with Retry-After', async ({ request }) => {
  const statuses: number[] = [];
  let last;
  for (let i = 0; i < 6; i++) {
    last = await request.post(POST, { headers: headers('10.1.0.7'), data: form(`e2e: burst ${i}`), maxRedirects: 0 });
    statuses.push(last.status());
  }
  expect(statuses.slice(0, 5)).toEqual([303, 303, 303, 303, 303]);
  expect(statuses[5]).toBe(429);
  expect(Number(last!.headers()['retry-after'])).toBeGreaterThan(0);
});
