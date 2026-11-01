import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Client } from 'pg';
import { E2E_DATABASE_URL } from '../../playwright.config';

// The e2e database is shared by the suite, so each test uses its own client address (X-Forwarded-For) to keep its
// rate-limit bucket separate, and counts rows by a unique message.
const PAGE = '/report/discover/a-day-in-shadows/';
const POST = `${PAGE}submit/`;
const form = (message: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({ reason: 'wrong', message, website: '', ...extra }).toString();
const headers = (ip: string) => ({ 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip });

async function rowsWith(message: string): Promise<number> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const r = await client.query('SELECT count(*)::int AS n FROM problem_reports WHERE message = $1', [message]);
    return r.rows[0].n;
  } finally {
    await client.end();
  }
}

test('the form submits, stores a row and confirms with a status message', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': '10.0.0.1' });
  await page.goto(PAGE);
  await page.getByLabel(/Anything else/).fill('e2e: the third paragraph is wrong');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page).toHaveURL(/\?sent=1$/);
  await expect(page.getByRole('status')).toContainText('Thank you');
  expect(await rowsWith('e2e: the third paragraph is wrong')).toBe(1);
});

test('the form is completable by keyboard and passes axe', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': '10.0.0.2' });
  await page.goto(PAGE);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'), JSON.stringify(result.violations)).toEqual([]);
  await page.getByRole('radio', { name: /unsafe/ }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel(/Anything else/)).toBeFocused();
  await page.keyboard.type('e2e: keyboard only');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Send report' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toBeVisible();
  expect(await rowsWith('e2e: keyboard only')).toBe(1);
});

test('works without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, extraHTTPHeaders: { 'x-forwarded-for': '10.0.0.3' } });
  const page = await context.newPage();
  await page.goto(`http://localhost:4173${PAGE}`);
  await page.getByLabel(/Anything else/).fill('e2e: no javascript');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  expect(await rowsWith('e2e: no javascript')).toBe(1);
  await context.close();
});

test('a POST with a foreign Origin is refused and stores nothing', async ({ request }) => {
  const res = await request.post(POST, { headers: { ...headers('10.0.0.4'), origin: 'https://evil.example' }, data: form('e2e: foreign origin'), maxRedirects: 0 });
  expect(res.status()).toBe(403);
  expect(await rowsWith('e2e: foreign origin')).toBe(0);
});

test('a filled honeypot redirects as if stored but writes nothing', async ({ request }) => {
  const res = await request.post(POST, { headers: headers('10.0.0.5'), data: form('e2e: honeypot', { website: 'x' }), maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers().location).toBe(`${PAGE}?sent=1`);
  expect(await rowsWith('e2e: honeypot')).toBe(0);
});

test('an unknown item is 404 and the sixth rapid POST from one client is 429 with Retry-After', async ({ request }) => {
  const missing = await request.post('/report/discover/no-such-item/submit/', { headers: headers('10.0.0.6'), data: form('e2e: missing'), maxRedirects: 0 });
  expect(missing.status()).toBe(404);
  const statuses: number[] = [];
  let last;
  for (let i = 0; i < 6; i++) {
    last = await request.post(POST, { headers: headers('10.0.0.7'), data: form(`e2e: burst ${i}`), maxRedirects: 0 });
    statuses.push(last.status());
  }
  expect(statuses.slice(0, 5)).toEqual([303, 303, 303, 303, 303]);
  expect(statuses[5]).toBe(429);
  expect(Number(last!.headers()['retry-after'])).toBeGreaterThan(0);
});
