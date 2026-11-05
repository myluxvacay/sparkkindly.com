import { createHash, randomBytes } from 'node:crypto';
import { test, expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { activeModerator, addItem, sql } from './helpers/fixtures';
import { BASE, FORM, form, session, signInContext } from './helpers/admin';

// Comments (plan 7A Task 2). The preview server on 4173 runs with ACCOUNTS_ENABLED and COMMENTS_ENABLED; the server on
// 4174 has neither, so it covers the flag-off 404s. Only example.test addresses; sign-in links are minted as rows, as in
// accounts.spec.ts. Items are e2e fixtures (created_by 'e2e'), so their comments go with them.

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
// A date of birth `years` ago plus about seven months, so the age cannot roll over mid-run.
const dobYearsAgo = (years: number) => {
  const d = new Date(Date.now() - 200 * 86_400_000);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};
let n = 0;
const stamp = Date.now();
const fresh = () => `e2e-comment-${stamp}-${n++}@example.test`;

// A verified account of the given age signed in on its own browser context (its own network address).
async function member(browser: Browser, years: number): Promise<{ page: Page; id: string; token: string }> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `203.0.113.${(n = n + 1) % 250}` } });
  const page = await context.newPage();
  const email = fresh();
  await page.goto('/account/sign-up/');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Date of birth').fill(dobYearsAgo(years));
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  const link = randomBytes(32).toString('hex');
  await sql("INSERT INTO account_login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '15 minutes')", [hash(link), email]);
  await page.goto(`/account/sign-in/link/?token=${link}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/account\/$/);
  const id = (await sql('SELECT id FROM accounts WHERE email = $1', [email])).rows[0].id as string;
  const token = (await context.cookies(BASE)).find((c) => c.name === '__Host-sk_account')!.value;
  return { page, id, token };
}

async function post(page: Page, body: string, first = false) {
  await page.getByLabel('Your comment', { exact: true }).fill(body);
  if (first) {
    await page.getByLabel('Display name').fill('Robin');
    await page.getByLabel(/I have read the/).check();
  }
  await page.getByRole('button', { name: 'Post comment' }).click();
}
const section = (page: Page) => page.locator('#comments');
const said = (page: Page, text: string) => section(page).locator('.comment-body', { hasText: text });

test.beforeEach(async () => {
  await activeModerator();
});

test('with the flags off every comment route is a 404 (server without the flags)', async ({ request }) => {
  for (const path of ['/comments/post/', '/comments/edit/', '/comments/delete/']) {
    const r = await request.post(OFF + path, { headers: { ...FORM, origin: OFF }, data: form({ body: 'hi' }), maxRedirects: 0 });
    expect(r.status(), path).toBe(404);
  }
  expect((await request.get(`${OFF}/community/guidelines/`)).status()).toBe(404);
});

test('a 16-year-old is held, then promoted by the owner and published at once; links follow the trust level', async ({ browser }) => {
  const slug = `e2e-comments-${stamp}`;
  await addItem({ world: 'play', slug, title: 'Comment fixture' });
  const url = `/play/${slug}/`;
  const teen = await member(browser, 16);
  await teen.page.goto(url);
  await expect(teen.page.getByRole('heading', { level: 2, name: 'Comments' })).toBeVisible();
  await axeBothWidths(teen.page);

  await post(teen.page, `My first words ${stamp}`, true);
  await expect(teen.page.locator('#result')).toContainText('waiting for review');
  await expect(section(teen.page).getByText('Waiting for review.')).toBeVisible();
  await expect(said(teen.page, `My first words ${stamp}`)).toBeVisible();

  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(url);
  await expect(section(anonPage)).toBeVisible();
  await expect(said(anonPage, `My first words ${stamp}`)).toHaveCount(0);
  await expect(section(anonPage).locator('textarea')).toHaveCount(0);

  await post(teen.page, `See www.example.org ${stamp}`);
  await expect(teen.page.locator('#result')).toContainText('Links are not allowed');

  const owner = await browser.newContext();
  await signInContext(owner, await session());
  const admin = await owner.newPage();
  const commentId = (await sql('SELECT id FROM comments WHERE account_id = $1', [teen.id])).rows[0].id as string;
  await admin.goto(`/admin/comments/?comment=${commentId}`);
  await expect(admin.getByText('Robin')).toBeVisible();
  await admin.getByRole('button', { name: 'Set level 1' }).click();
  await expect(admin.getByText('Comment trust level saved.')).toBeVisible();

  await teen.page.goto(url);
  await post(teen.page, `Now at level one ${stamp}`);
  await expect(teen.page.locator('#result')).toContainText('Your comment is published');
  await post(teen.page, `Read www.example.org ${stamp}`);
  await expect(teen.page.locator('#result')).toContainText('Your comment is published');

  await anonPage.goto(url);
  await expect(said(anonPage, `Now at level one ${stamp}`)).toBeVisible();
  await expect(said(anonPage, `Read www.example.org ${stamp}`)).toBeVisible();
  await expect(section(anonPage).locator('a', { hasText: 'example.org' })).toHaveCount(0);
  await expect(said(anonPage, `My first words ${stamp}`)).toHaveCount(0);
  await expect(section(anonPage).locator('time').first()).toHaveAttribute('datetime', /^\d{4}-\d\d-\d\dT/);
  await axeBothWidths(anonPage);

  // The owner switches the world off: the section disappears; back on again.
  const admin2 = await owner.newPage();
  try {
    await admin2.goto('/admin/comments/');
    await admin2.getByRole('button', { name: 'Switch off comments: Play' }).click();
    await expect(admin2.getByText('Comments switched off for that world.')).toBeVisible();
    await anonPage.goto(url);
    await expect(anonPage.getByRole('heading', { level: 1, name: 'Comment fixture' })).toBeVisible();
    await expect(section(anonPage)).toHaveCount(0);
  } finally {
    await sql("UPDATE worlds SET comments_enabled = true WHERE slug = 'play'");
  }
  await anon.close();
  await owner.close();
});

test('a child profile sees no comment section on Play or Discover items; no section on a Kids item', async ({ browser }) => {
  const play = `e2e-comments-child-play-${stamp}`;
  const discover = `e2e-comments-child-discover-${stamp}`;
  const kids = `e2e-comments-kids-${stamp}`;
  await addItem({ world: 'play', slug: play, title: 'Child play fixture' });
  await addItem({ world: 'discover', slug: discover, title: 'Child discover fixture' });
  await addItem({ world: 'kids', slug: kids, audience: 'kids', title: 'Kids comment fixture' });
  const adult = await member(browser, 35);
  for (const path of [`/play/${play}/`, `/discover/${discover}/`]) {
    await adult.page.goto(path);
    await expect(section(adult.page)).toBeVisible();
  }
  const kid = (await sql("INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, 'Mo', '6-9') RETURNING id", [adult.id])).rows[0].id;
  await sql('UPDATE account_sessions SET active_profile_id = $1 WHERE token_hash = $2', [kid, hash(adult.token)]);
  for (const path of [`/play/${play}/`, `/discover/${discover}/`]) {
    await adult.page.goto(path);
    await expect(adult.page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(section(adult.page)).toHaveCount(0);
    expect(await adult.page.content()).not.toContain('comments-heading');
  }
  const r = await adult.page.request.post('/comments/post/', { headers: { ...FORM, origin: BASE }, data: form({ body: 'child words' }), maxRedirects: 0 });
  expect(r.status()).toBe(403);

  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`/kids/${kids}/`);
  await expect(anonPage.getByRole('heading', { level: 1, name: 'Kids comment fixture' })).toBeVisible();
  await expect(section(anonPage)).toHaveCount(0);
  await anon.close();
});
