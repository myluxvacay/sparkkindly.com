import { test, expect } from '@playwright/test';

// Project 1D, Task 3: the trust pages exist, are reachable, and say only what the product does.
const PAGES = ['/about/', '/editorial-policy/', '/privacy/', '/terms/', '/accessibility/', '/contact/'];

test('every trust page has one h1, a current-page breadcrumb and a footer link', async ({ page }) => {
  for (const path of PAGES) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { level: 1 }), path).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).locator('[aria-current="page"]'), path).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Information' }).locator(`a[href="${path}"]`), path).toHaveCount(1);
  }
});

test('trust pages make no third-party request and store nothing in the browser', async ({ page, context }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:4173/')) outside.push(r.url());
  });
  for (const path of PAGES) {
    await page.goto(path);
    expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), path).toEqual({ local: 0, session: 0 });
  }
  expect(await context.cookies()).toEqual([]);
  expect(outside).toEqual([]);
});

test('no trust page offers a feature that does not exist yet', async ({ page }) => {
  const forbidden = [/sign up/i, /create an account/i, /log ?in/i, /sign ?in/i, /join (a|the) (circle|community)/i, /leave a comment/i];
  for (const path of PAGES) {
    await page.goto(path);
    const text = await page.locator('main').innerText();
    for (const re of forbidden) expect(text, `${path} ${re}`).not.toMatch(re);
  }
});

test('the privacy page states what is true: no accounts, no outside requests, answers not saved, Kids rules', async ({ page }) => {
  await page.goto('/privacy/');
  const text = await page.locator('main').innerText();
  expect(text).toMatch(/no accounts/i);
  expect(text).toMatch(/no requests to other companies/i);
  expect(text).toMatch(/does not save it/i);
  expect(text).toMatch(/13 to 15/);
  expect(text).toMatch(/under 13 cannot have an account/);
  expect(text).toMatch(/Report a problem/);
});

test('no page claims an answer is wholly unrecorded; each says it is not saved and points to the privacy guide', async ({ page }) => {
  await page.goto('/about/');
  const about = page.locator('main');
  await expect(about).toContainText('SparkKindly does not save your answer');
  await expect(about).not.toContainText(/nothing about your answer is kept/i);
  await expect(about.getByRole('link', { name: /privacy/i }).first()).toHaveAttribute('href', '/privacy/');
  await page.goto('/play/number-detective-001/');
  const note = page.locator('.quiz-note');
  await expect(note).toContainText('does not save your answer');
  await expect(note).not.toContainText(/nothing is recorded/i);
  await expect(note.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/privacy/');
  await page.goto('/privacy/');
  await expect(page.locator('main')).toContainText(/can appear in the web server’s ordinary technical logs/);
});

test('the editorial policy discloses AI assistance and that Kids content waits for the owner', async ({ page }) => {
  await page.goto('/editorial-policy/');
  const text = await page.locator('main').innerText();
  expect(text).toMatch(/written with the help of AI/);
  expect(text).toMatch(/Kids world waits for the site owner/);
  expect(text).toMatch(/not a specialist, legal or professional fact-check/);
});

test('with no CONTACT_EMAIL configured the contact and accessibility pages publish no address', async ({ page }) => {
  for (const path of ['/contact/', '/accessibility/']) {
    await page.goto(path);
    await expect(page.locator('main a[href^="mailto:"]'), path).toHaveCount(0);
    expect(await page.locator('main').innerText(), path).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);
  }
  await page.goto('/contact/');
  await expect(page.getByText(/has not been published yet/)).toBeVisible();
});
