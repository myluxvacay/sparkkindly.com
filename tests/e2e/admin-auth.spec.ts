import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { sql } from './helpers/fixtures';
import { BASE, FORM, ORIGIN, OWNER, auditCount, codeFor, cookieHeader, csrfFor, enrol, form, linkToken, session, signInContext } from './helpers/admin';

// The adversarial matrix for admin sign-in (data-isolation.md, security.md): only an allow-listed address that has
// used its emailed link AND given its authenticator code is an admin, on every request.

const PAGES = ['/admin/', '/admin/items/', '/admin/items/new/', '/admin/reports/', '/admin/worlds/', '/admin/topics/', '/admin/agents/', '/admin/runs/', '/admin/digest/'];
const axe = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
};

test('the full sign-in: emailed link, Continue, authenticator code, then the queue', async ({ page }) => {
  const secret = await enrol();
  const token = await linkToken();
  const before = await auditCount('sign_in_code_ok');
  await page.goto(`/admin/sign-in/link/?token=${token}`);
  expect(await axe(page)).toEqual([]);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/admin\/sign-in\/code\/$/);
  expect(await axe(page)).toEqual([]);
  await page.getByLabel(/Six-digit code/).fill(codeFor(secret));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Approval queue' })).toBeVisible();
  expect(await auditCount('sign_in_code_ok')).toBe(before + 1);
  const cookies = await page.context().cookies(BASE);
  const c = cookies.find((x) => x.name === '__Host-sk_admin')!;
  expect([c.httpOnly, c.secure, c.sameSite]).toEqual([true, true, 'Strict']);
});

test('every admin page sends a visitor with no session to sign in', async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/admin\/sign-in\/$/);
  }
});

test('a session that used its link but not its code reaches no admin page or action', async ({ page, context, request }) => {
  const pending = await session('code');
  await signInContext(context, pending);
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/admin\/sign-in\/$/);
  }
  const r = await request.post('/admin/act/', {
    headers: { ...FORM, ...ORIGIN, ...cookieHeader(pending) },
    data: form({ csrf: csrfFor(pending), action: 'topic.create', slug: 'e2e-pending', name: 'X', return: '/admin/topics/' }),
    maxRedirects: 0,
  });
  expect(r.status()).toBe(303);
  expect(r.headers().location).toBe('/admin/sign-in/');
  expect((await sql("SELECT 1 FROM topics WHERE slug = 'e2e-pending'")).rows).toHaveLength(0);
});

test('a session for an address not on the allow-list is refused', async ({ page, context }) => {
  await signInContext(context, await session('active', 'former@example.test'));
  await page.goto('/admin/');
  await expect(page).toHaveURL(/\/admin\/sign-in\/$/);
});

test('admin POSTs without Origin, from a foreign Origin, without CSRF or with another session’s CSRF are 403 and change nothing', async ({ request }) => {
  const s = await session();
  const other = await session();
  const base = { action: 'topic.create', name: 'X', return: '/admin/topics/' };
  const attempts = [
    { headers: { ...FORM, ...cookieHeader(s) }, data: { ...base, slug: 'e2e-csrf-a', csrf: csrfFor(s) } },
    { headers: { ...FORM, ...cookieHeader(s), origin: 'https://evil.example' }, data: { ...base, slug: 'e2e-csrf-b', csrf: csrfFor(s) } },
    { headers: { ...FORM, ...cookieHeader(s), ...ORIGIN }, data: { ...base, slug: 'e2e-csrf-c' } },
    { headers: { ...FORM, ...cookieHeader(s), ...ORIGIN }, data: { ...base, slug: 'e2e-csrf-d', csrf: csrfFor(other) } },
  ];
  for (const a of attempts) {
    const r = await request.post('/admin/act/', { headers: a.headers, data: form(a.data), maxRedirects: 0 });
    expect(r.status(), a.data.slug).toBe(403);
  }
  expect((await sql("SELECT 1 FROM topics WHERE slug LIKE 'e2e-csrf-%'")).rows).toHaveLength(0);
});

test('the sign-in request answers allowed and unknown addresses identically and never returns a token', async ({ request }) => {
  const ask = (email: string, ip: string) =>
    request.post('/admin/sign-in/request/', { headers: { ...FORM, ...ORIGIN, 'x-forwarded-for': ip }, data: form({ email }), maxRedirects: 0 });
  const a = await ask(OWNER, '192.0.2.10');
  const b = await ask('stranger@example.test', '192.0.2.11');
  expect([a.status(), b.status()]).toEqual([303, 303]);
  expect(a.headers().location).toBe(b.headers().location);
  expect(a.headers()['set-cookie']).toBeUndefined();
  expect(await a.text()).not.toMatch(/[0-9a-f]{64}/);
  const noOrigin = await request.post('/admin/sign-in/request/', { headers: FORM, data: form({ email: OWNER }), maxRedirects: 0 });
  expect(noOrigin.status()).toBe(403);
});

test('the sign-in page passes axe and works from the keyboard', async ({ page }) => {
  await page.goto('/admin/sign-in/');
  expect(await axe(page)).toEqual([]);
  await page.getByLabel('Email address').focus();
  await page.keyboard.type('stranger@example.test');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeFocused();
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': '192.0.2.20' });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('If that address may sign in');
});

test('a used link cannot start a second session', async ({ page }) => {
  await enrol();
  const token = await linkToken();
  await page.goto(`/admin/sign-in/link/?token=${token}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/code\/$/);
  await page.goto(`/admin/sign-in/link/?token=${token}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\?expired=1$/);
});

test('signing out ends the session; the old cookie is refused afterwards', async ({ page, context, request }) => {
  const s = await session();
  await signInContext(context, s);
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/admin\/sign-in\/$/);
  const r = await request.get('/admin/', { headers: cookieHeader(s), maxRedirects: 0 });
  expect(r.status()).toBeGreaterThanOrEqual(300);
  expect(r.status()).toBeLessThan(400);
});
