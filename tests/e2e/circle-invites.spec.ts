import { createHash, randomBytes } from 'node:crypto';
import { test, expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { sql } from './helpers/fixtures';
import { FORM, form } from './helpers/admin';

// Invites and communities (plan 4B Task 2). The preview server on 4173 runs with ACCOUNTS_ENABLED and CIRCLES_ENABLED;
// the server on 4174 has neither. Only example.test addresses; sign-in links are minted as rows (no email is sent).

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
const fresh = () => `e2e-invite-${Date.now()}-${n++}@example.test`;

async function visitor(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `203.0.113.${(n = n + 1) % 250}` } });
  return context.newPage();
}
// Signs up on `page` (already on the sign-up page or not), then uses a minted link, optionally carrying `next`.
async function signUpAndIn(page: Page, email: string, dob: string, opts: { parent?: string; next?: string; onForm?: boolean } = {}) {
  if (!opts.onForm) await page.goto('/account/sign-up/');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Date of birth').fill(dob);
  if (opts.parent) await page.getByLabel(/Parent or guardian email/).fill(opts.parent);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  const token = randomBytes(32).toString('hex');
  await sql("INSERT INTO account_login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '15 minutes')", [hash(token), email]);
  await page.goto(`/account/sign-in/link/?token=${token}${opts.next ? `&next=${encodeURIComponent(opts.next)}` : ''}`);
  await page.getByRole('button', { name: 'Continue' }).click();
}
async function adult(browser: Browser) {
  const page = await visitor(browser);
  await signUpAndIn(page, fresh(), '1988-04-04');
  await expect(page).toHaveURL(/\/account\/$/);
  return page;
}
async function createCircle(page: Page, name: string, kind: RegExp, yourName: string, description?: string) {
  await page.goto('/circles/new/');
  await page.getByLabel('Circle name').fill(name);
  await page.getByRole('radio', { name: kind }).check();
  await page.getByLabel('Your name in this circle').fill(yourName);
  if (description) await page.getByLabel(/Description/).fill(description);
  await page.getByRole('button', { name: 'Create the circle' }).click();
  await expect(page.getByRole('status')).toContainText('Your circle is ready');
}
async function makeLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: /^Make (an|a new) invite link$/ }).click();
  await expect(page.getByRole('status')).toContainText('Your new invite link');
  const url = await page.getByLabel(/Your invite link/).inputValue();
  return new URL(url).pathname;
}

test('with the flags off every invite and community page and route is a 404', async ({ request }) => {
  for (const path of [`/circles/join/${'A'.repeat(43)}/`, '/circles/communities/', '/circles/invite-image/']) {
    expect((await request.get(OFF + path)).status(), path).toBe(404);
  }
  const posts = [
    `/circles/join/${'A'.repeat(43)}/accept/`,
    '/circles/communities/join/',
    ...['link', 'email', 'revoke'].map((a) => `/circles/abcdefghij/invite/${a}/`),
  ];
  for (const path of posts) {
    const r = await request.post(OFF + path, { headers: { ...FORM, origin: OFF }, data: form({ your_name: 'X' }), maxRedirects: 0 });
    expect(r.status(), path).toBe(404);
  }
});

test('a visitor opens a link invite, signs up through it and joins; the old link fails after regenerate', async ({ browser }) => {
  const owner = await adult(browser);
  await createCircle(owner, 'Quiz Owls', /^Friends:/, 'Olly Owner');
  const path = await makeLink(owner);
  expect(path).toMatch(/^\/circles\/join\/[A-Za-z0-9_-]{43}\/$/);
  await axeBothWidths(owner);

  const guest = await visitor(browser);
  const res = await guest.goto(path);
  expect(res!.headers()['cache-control']).toContain('no-store');
  expect(res!.headers()['referrer-policy']).toBe('no-referrer');
  await expect(guest.getByRole('heading', { level: 1, name: 'Join Quiz Owls' })).toBeVisible();
  await expect(guest.locator('meta[property="og:title"]')).toHaveAttribute('content', /Quiz Owls/);
  await expect(guest.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/circles\/invite-image\//);
  await expect(guest.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  const html = await guest.content();
  expect(html).not.toContain('Olly');
  expect(html).not.toContain('@example.test');
  await axeBothWidths(guest);
  const image = await guest.request.get('/circles/invite-image/');
  expect([image.status(), image.headers()['content-type']]).toEqual([200, 'image/png']);

  await guest.getByRole('link', { name: 'create an account' }).click();
  await expect(guest.locator('input[name="next"]')).toHaveValue(path);
  await signUpAndIn(guest, fresh(), '1995-02-02', { next: path, onForm: true });
  await expect(guest).toHaveURL(new RegExp(`${path}$`));
  await guest.getByLabel('Your name in this circle').fill('Gus');
  await guest.getByRole('button', { name: 'Join the circle' }).click();
  await expect(guest.getByRole('status')).toContainText('You are in the circle');
  await expect(guest.getByRole('heading', { level: 1, name: 'Quiz Owls' })).toBeVisible();
  const referrals = await sql(
    `SELECT count(*)::int AS n FROM referrals r JOIN circle_invites i ON i.id = r.invite_id WHERE i.token_hash = $1`,
    [hash(path.split('/')[3])],
  );
  expect(referrals.rows[0].n).toBe(1);

  await owner.reload();
  await makeLink(owner);
  expect((await (await visitor(browser)).goto(path))!.status()).toBe(404);
});

test('a confirmed 14-year-old joins a friends circle by link but is refused a community; the listing is public', async ({ browser }) => {
  const owner = await adult(browser);
  await createCircle(owner, 'Club Night', /^Community:/, 'Host Hana', 'A friendly quiz community');
  await createCircle(owner, 'Study Buddies', /^Friends:/, 'Host Hana');
  const path = await makeLink(owner);

  const anon = await visitor(browser);
  await anon.goto('/circles/communities/');
  await expect(anon.getByRole('heading', { level: 2, name: 'Club Night' })).toBeVisible();
  await expect(anon.getByText('A friendly quiz community')).toBeVisible();
  expect(await anon.content()).not.toContain('Host Hana');
  await expect(anon.getByRole('heading', { level: 2, name: 'Study Buddies' })).toHaveCount(0);
  await axeBothWidths(anon);

  const teen = await visitor(browser);
  const email = fresh();
  await signUpAndIn(teen, email, '2012-03-03', { parent: fresh() });
  await sql("UPDATE accounts SET consent_state = 'confirmed', consent_at = now() WHERE email = $1", [email]);
  await teen.goto(path);
  await teen.getByLabel('Your name in this circle').fill('Tia');
  await teen.getByRole('button', { name: 'Join the circle' }).click();
  await expect(teen.getByRole('heading', { level: 1, name: 'Study Buddies' })).toBeVisible();

  await teen.goto('/circles/communities/');
  await teen.getByLabel('Your name in Club Night').fill('Tia');
  await teen.getByRole('button', { name: 'Join Club Night' }).click();
  await expect(teen.locator('#result')).toContainText('aged 16 and over');
});
