import { createHash, randomBytes } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { sql } from './helpers/fixtures';
import { BASE, FORM, ORIGIN, form } from './helpers/admin';

// Member accounts (Project 3A, Task 4). The preview server on 4173 runs with ACCOUNTS_ENABLED=true; the server on
// 4174 does not, so it covers the flag-off 404s. Only example.test addresses. There is no mail sink in this harness:
// the emailed link is a row in account_login_tokens, so a spec mints the token the same way requestAccountLink does.

const OFF = 'http://localhost:4174';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
};
// A date of birth `years` ago plus about seven months, so the age cannot roll over mid-run.
const dobYearsAgo = (years: number) => {
  const d = new Date(Date.now() - 200 * 86_400_000);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};
const accountRows = async (email: string) => (await sql('SELECT 1 FROM accounts WHERE email = $1', [email])).rows.length;
const mintLink = async (email: string) => {
  const token = randomBytes(32).toString('hex');
  await sql("INSERT INTO account_login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '15 minutes')", [hash(token), email]);
  return token;
};
let n = 0;
const fresh = () => `e2e-acct-${Date.now()}-${n++}@example.test`;

test.beforeEach(async ({ page }) => {
  // Each test is its own network, so the per-network sign-up limit (30 an hour) never trips across tests.
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${(n = n + 1) % 250}` });
});

async function signUp(page: Page, email: string, dob: string, parent?: string) {
  await page.goto('/account/sign-up/');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Date of birth').fill(dob);
  if (parent) await page.getByLabel(/Parent or guardian email/).fill(parent);
  await page.getByRole('button', { name: 'Create account' }).click();
}

async function signInWithLink(page: Page, email: string) {
  const token = await mintLink(email);
  await page.goto(`/account/sign-in/link/?token=${token}`);
  await expect(page.getByText(`Sign in as ${email}`)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('an unconfirmed account shows its age group and a masked parent email on the link page; a confirmed one does not', async ({ page }) => {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(14), 'guardian@example.test');
  await page.goto(`/account/sign-in/link/?token=${await mintLink(email)}`);
  await expect(page.getByText('Age 13 to 15, consent pending')).toBeVisible();
  await expect(page.getByText('g•••@example.test')).toBeVisible();
  await expect(page.getByText('guardian@example.test')).toHaveCount(0);
  await expect(page.getByText('close this page')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto(`/account/sign-in/link/?token=${await mintLink(email)}`);
  await expect(page.getByText(`Sign in as ${email}`)).toBeVisible();
  await expect(page.getByText('close this page')).toHaveCount(0);
});

test('with the flag off every account page and route is a 404 (server without ACCOUNTS_ENABLED)', async ({ request }) => {
  for (const path of ['/account/', '/account/sign-up/', '/account/sign-in/', '/account/sign-in/link/?token=x']) {
    expect((await request.get(OFF + path)).status(), path).toBe(404);
  }
  for (const path of ['/account/sign-up/submit/', '/account/sign-in/request/', '/account/sign-in/link/confirm/', '/account/sign-out/']) {
    const r = await request.post(OFF + path, { headers: { ...FORM, origin: OFF }, data: form({ email: 'a@example.test' }), maxRedirects: 0 });
    expect(r.status(), path).toBe(404);
  }
});

test('a 20-year-old signs up, uses the emailed link, sees their account and signs out', async ({ page }) => {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(20));
  await expect(page.getByRole('status')).toContainText('Check your email to continue');
  expect(await accountRows(email)).toBe(1);

  await signInWithLink(page, email);
  await expect(page).toHaveURL(/\/account\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText('Adult account')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  const cookies = await page.context().cookies(BASE);
  expect(cookies.map((c) => c.name)).toContain('__Host-sk_account');
  const c = cookies.find((x) => x.name === '__Host-sk_account')!;
  expect([c.httpOnly, c.secure, c.sameSite, c.path]).toEqual([true, true, 'Lax', '/']);
  expect(Math.round((c.expires - Date.now() / 1000) / 86_400)).toBe(30);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/account\/sign-in\/$/);
  expect((await page.context().cookies(BASE)).find((x) => x.name === '__Host-sk_account')).toBeUndefined();
  await page.goto('/account/');
  await expect(page).toHaveURL(/\/account\/sign-in\/$/);
});

test('a used link cannot start a second session, and a signed-out cookie stays dead', async ({ page, request }) => {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(20));
  const token = await mintLink(email);
  await page.goto(`/account/sign-in/link/?token=${token}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  const session = (await page.context().cookies(BASE)).find((x) => x.name === '__Host-sk_account')!.value;
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto(`/account/sign-in/link/?token=${token}`);
  await expect(page.getByRole('alert').filter({ hasText: 'not valid' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  const r = await request.get('/account/', { headers: { cookie: `__Host-sk_account=${session}` }, maxRedirects: 0 });
  expect(r.status()).toBeGreaterThanOrEqual(300);
  expect(r.status()).toBeLessThan(400);
});

test('a 12-year-old gets the child-profile message and nothing is stored', async ({ page }) => {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(12));
  await expect(page.getByRole('status')).toContainText('Accounts start at 13');
  await expect(page.getByRole('status')).toContainText('child profile');
  expect(await accountRows(email)).toBe(0);
  const ever = await sql("SELECT 1 FROM accounts WHERE email LIKE '%' || $1 || '%'", [email]);
  expect(ever.rows).toHaveLength(0);
});

test('a 14-year-old is asked for a parent email, and the account says consent is pending', async ({ page }) => {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(14));
  await expect(page.locator('#parent-error')).toContainText('parent or guardian');
  expect(await accountRows(email)).toBe(0);
  await expect(page.getByLabel(/Parent or guardian email/)).toHaveAttribute('aria-invalid', 'true');

  await signUp(page, email, dobYearsAgo(14), 'parent@example.test');
  await expect(page.getByRole('status')).toContainText('Check your email to continue');
  expect(await accountRows(email)).toBe(1);
  await signInWithLink(page, email);
  await expect(page.getByText('Age 13 to 15, consent pending')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('save interests only');
});

test('an existing address signing up again gets the same answer as a new one, and no second account', async ({ request }) => {
  const email = fresh();
  const post = (ip: string) =>
    request.post('/account/sign-up/submit/', { headers: { ...FORM, ...ORIGIN, 'x-forwarded-for': ip }, data: form({ email, dob: dobYearsAgo(30) }), maxRedirects: 0 });
  const a = await post('203.0.113.1');
  const b = await post('203.0.113.2');
  expect([a.status(), b.status()]).toEqual([303, 303]);
  expect(a.headers().location).toBe(b.headers().location);
  expect(await accountRows(email)).toBe(1);
});

test('a link request answers a known and an unknown address identically', async ({ request }) => {
  const known = fresh();
  await sql("INSERT INTO accounts (email, date_of_birth) VALUES ($1, '1990-01-01')", [known]);
  const ask = (email: string, ip: string) =>
    request.post('/account/sign-in/request/', { headers: { ...FORM, ...ORIGIN, 'x-forwarded-for': ip }, data: form({ email }), maxRedirects: 0 });
  const a = await ask(known, '203.0.113.10');
  const b = await ask('stranger@example.test', '203.0.113.11');
  expect([a.status(), b.status()]).toEqual([303, 303]);
  expect(a.headers().location).toBe(b.headers().location);
  expect(await a.text()).toBe(await b.text());
  expect(a.headers()['set-cookie']).toBeUndefined();
  expect(await a.text()).not.toMatch(/[0-9a-f]{64}/);
  expect((await request.post('/account/sign-in/request/', { headers: FORM, data: form({ email: known }), maxRedirects: 0 })).status()).toBe(403);
});

test('the 31st sign-up from one network in an hour is refused with 429', async ({ request }) => {
  // A network unique to this run, so a local re-run within the hour does not start out limited.
  const [x, y] = randomBytes(2);
  const ip = `198.18.${x}.${y}`;
  const codes: number[] = [];
  for (let i = 0; i < 31; i++) {
    const r = await request.post('/account/sign-up/submit/', {
      headers: { ...FORM, ...ORIGIN, 'x-forwarded-for': ip },
      data: form({ email: 'not-an-email', dob: dobYearsAgo(30) }),
      maxRedirects: 0,
    });
    codes.push(r.status());
  }
  expect(codes).toEqual([...Array(30).fill(303), 429]);
});

test('sign-out and sign-up POSTs from another origin are refused', async ({ request }) => {
  for (const path of ['/account/sign-out/', '/account/sign-up/submit/']) {
    const r = await request.post(path, { headers: { ...FORM, origin: 'https://evil.example' }, data: form({ email: 'a@example.test' }), maxRedirects: 0 });
    expect(r.status(), path).toBe(403);
  }
});

test('the date of birth field asks the browser for a birthday (WCAG 1.3.5)', async ({ page }) => {
  await page.goto('/account/sign-up/');
  await expect(page.getByLabel('Date of birth')).toHaveAttribute('autocomplete', 'bday');
});

test('the link page names the account, warns when it would switch accounts, and is generic for a bad link', async ({ page }) => {
  const a = fresh();
  const b = fresh();
  await signUp(page, a, dobYearsAgo(30));
  await signUp(page, b, dobYearsAgo(30));
  await signInWithLink(page, a);
  await expect(page.getByText(a)).toBeVisible();
  await page.goto(`/account/sign-in/link/?token=${await mintLink(b)}`);
  await expect(page.getByText(`Sign in as ${b}`)).toBeVisible();
  await expect(page.getByRole('status')).toContainText(`signed in as ${a}`);
  await expect(page.getByRole('status')).toContainText('switch accounts');
  await page.goto(`/account/sign-in/link/?token=${'0'.repeat(64)}`);
  await expect(page.getByRole('alert').filter({ hasText: 'not valid' })).toBeVisible();
  await expect(page.getByText('Sign in as')).toHaveCount(0);
});

test('the sign-up and sign-in pages pass axe and sign-in works from the keyboard', async ({ page }) => {
  await page.goto('/account/sign-up/');
  expect(await axe(page)).toEqual([]);
  await page.goto('/account/sign-in/');
  expect(await axe(page)).toEqual([]);
  await page.getByLabel('Email address').focus();
  await page.keyboard.type('stranger@example.test');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('If that address has an account');
});
