import { createHash, randomBytes } from 'node:crypto';
import { test, expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { sql } from './helpers/fixtures';
import { BASE, FORM, form, session, signInContext } from './helpers/admin';
import { generateKey } from '../../lib/agents/keys';

// Contributors (plan 8 Task 4). The preview server on 4173 runs with ACCOUNTS_ENABLED and CONTRIBUTORS_ENABLED; the
// server on 4174 has neither (flag-off 404s). The reviewer pass goes through the real verdict route with a test agent
// key (no real agent). Ruling: the e2e article is a Grow piece without sources (Reflective tier), so the server's source
// check never reaches the network from a test; source checks are covered by the unit tests with a stub probe.

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
const dobYearsAgo = (years: number) => {
  const d = new Date(Date.now() - 200 * 86_400_000);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};
let n = 0;
const stamp = Date.now();
const fresh = () => `e2e-contrib-${stamp}-${n++}@example.test`;

async function member(browser: Browser, years: number): Promise<{ page: Page; id: string; token: string }> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${(n = n + 1) % 250}` } });
  const page = await context.newPage();
  const email = fresh();
  await page.goto('/account/sign-up/');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Date of birth').fill(dobYearsAgo(years));
  if (years < 16) await page.getByLabel(/Parent or guardian email/).fill(`parent-${stamp}-${n}@example.test`);
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

async function agentKey(): Promise<string> {
  const { key, prefix, hash: h } = generateKey();
  await sql("INSERT INTO agents (name, world_id, key_prefix, key_hash, role) VALUES ($1, NULL, $2, $3, 'reviewer')", [`e2e-reviewer-${stamp}-${n++}`, prefix, h]);
  return key;
}

async function writeArticle(page: Page, title: string) {
  await page.goto('/me/contribute/?new=article');
  await page.getByLabel('World').selectOption('grow');
  await page.getByLabel(/^Title/).fill(title);
  await page.getByLabel(/^Summary/).fill('A small habit that makes evenings calmer and kinder to yourself.');
  await page.getByLabel(/Section 1 heading/).fill('Start small');
  await page.getByLabel('Section 1 text').fill('Pick one minute at the end of the day.\n\nNotice one thing that went well.');
  await page.getByLabel(/Section 2 heading/).fill('Keep it light');
  await page.getByLabel('Section 2 text').fill('There is nothing to win. Skip a day and simply start again.');
  await page.getByLabel(/^Takeaway/).fill('One kind minute is enough.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status')).toContainText('Your draft is saved');
}

test('with the flags off every contribute page and route is a 404 (server without the flags)', async ({ request }) => {
  for (const path of ['/me/contribute/enable/', '/me/contribute/save/', '/me/contribute/submit/', '/me/contribute/withdraw/confirm/']) {
    const r = await request.post(OFF + path, { headers: { ...FORM, origin: OFF }, data: form({}), maxRedirects: 0 });
    expect(r.status(), path).toBe(404);
  }
  expect((await request.get(`${OFF}/contributors/terms/`)).status()).toBe(404);
  expect((await request.get(`${OFF}/contributors/abcdefghij/`)).status()).toBe(404);
});

test('a 16-year-old writes and submits; the reviewer passes it; the owner approves; it publishes with a byline; withdrawal removes it', async ({ browser, request }) => {
  const teen = await member(browser, 16);
  const page = teen.page;
  await page.goto('/me/contribute/');
  await expect(page.getByLabel(/One link/)).toHaveCount(0);
  await page.getByLabel(/Display name/).fill('Robin Writes');
  await page.getByLabel(/I accept the/).check();
  await page.getByRole('button', { name: 'Become a contributor' }).click();
  await expect(page.getByRole('status')).toContainText('profile is saved');

  const title = `Evening kindness minute ${stamp}`;
  await writeArticle(page, title);
  await axeBothWidths(page);
  const id = new URL(page.url()).searchParams.get('id')!;
  await page.getByLabel(/my own work/).check();
  await page.getByLabel(/I keep my copyright/).check();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByRole('status')).toContainText('waiting for review');

  // The reviewer pass, through the real route with a test master key.
  const key = await agentKey();
  const queue = await request.get('/api/agent/contributions/', { headers: { 'x-agent-key': key } });
  expect(queue.status()).toBe(200);
  const entry = (await queue.json()).contributions.find((c: { id: string }) => c.id === id);
  expect(JSON.stringify(entry)).not.toContain('Robin Writes');
  const verdict = await request.post('/api/agent/contributions/review/', {
    headers: { 'x-agent-key': key, 'content-type': 'application/json' },
    data: { id, version: entry.version, pass: true, reasons: ['kind and original'], sourcesChecked: [], plagiarismChecked: true },
  });
  expect(await verdict.json()).toEqual({ id, state: 'needs_owner' });

  // The owner approves from /admin/contributions/.
  const ownerCtx = await browser.newContext();
  await signInContext(ownerCtx, await session());
  const owner = await ownerCtx.newPage();
  await owner.goto('/admin/contributions/');
  await expect(owner.getByRole('heading', { level: 3, name: title })).toBeVisible();
  await axeBothWidths(owner);
  await owner.getByRole('button', { name: `Approve: ${title}` }).click();
  await expect(owner.getByRole('status')).toContainText('approved and scheduled');

  // publish-due's effect (the worker does not run in e2e): the scheduled item becomes published.
  const item = (await sql("SELECT i.id, i.slug FROM items i JOIN contributions c ON c.item_id = i.id WHERE c.id = $1 AND i.status = 'scheduled'", [id])).rows[0];
  await sql("UPDATE items SET status = 'published', published_at = now() - interval '1 minute' WHERE id = $1", [item.id]);

  const anon = await (await browser.newContext()).newPage();
  await anon.goto(`/grow/${item.slug}/`);
  const byline = anon.getByRole('link', { name: 'Robin Writes' });
  await expect(byline).toBeVisible();
  await byline.click();
  await expect(anon.getByRole('heading', { level: 1, name: 'Robin Writes' })).toBeVisible();
  await expect(anon.getByRole('link', { name: title })).toBeVisible();
  await axeBothWidths(anon);
  const contributorUrl = anon.url();

  // Withdrawal (with its confirm step) takes it down at once.
  await page.goto('/me/contribute/');
  await page.getByRole('link', { name: `Withdraw: ${title}` }).click();
  await page.getByRole('button', { name: 'Withdraw it' }).click();
  await expect(page.getByRole('status')).toContainText('withdrawn');
  expect((await anon.goto(`/grow/${item.slug}/`))!.status()).toBe(404);
  // Nothing published is left, so the contributor page is gone too.
  expect((await anon.goto(contributorUrl))!.status()).toBe(404);
  await ownerCtx.close();
});

test("a second account cannot open the first's draft; Kids is refused; a 14-year-old and a child profile get no contribute page", async ({ browser }) => {
  const a = await member(browser, 30);
  await a.page.goto('/me/contribute/');
  await a.page.getByLabel(/Display name/).fill('Ada Draft');
  await a.page.getByLabel(/I accept the/).check();
  await a.page.getByRole('button', { name: 'Become a contributor' }).click();
  await writeArticle(a.page, `Private draft ${stamp}`);
  const id = new URL(a.page.url()).searchParams.get('id')!;
  await expect(a.page.getByLabel('World').locator('option[value="kids"]')).toHaveCount(0);
  const kids = await a.page.request.post('/me/contribute/save/', {
    headers: { ...FORM, origin: BASE },
    data: form({ kind: 'article', world: 'kids', title: 'For kids', summary: 'A summary that is long enough.' }),
    maxRedirects: 0,
  });
  expect(kids.headers().location).toBe('/me/contribute/?r=invalid#result');

  const b = await member(browser, 30);
  expect((await b.page.goto(`/me/contribute/?id=${id}`))!.status()).toBe(404);
  expect((await b.page.goto(`/me/contribute/withdraw/?id=${id}`))!.status()).toBe(404);

  const young = await member(browser, 14);
  expect((await young.page.goto('/me/contribute/'))!.status()).toBe(404);

  const kid = (await sql("INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, 'Mo', '6-9') RETURNING id", [a.id])).rows[0].id;
  await sql('UPDATE account_sessions SET active_profile_id = $1 WHERE token_hash = $2', [kid, hash(a.token)]);
  await a.page.goto('/me/contribute/');
  await expect(a.page).toHaveURL(/\/account\/children\/playing\/$/);
  const r = await a.page.request.post('/me/contribute/save/', { headers: { ...FORM, origin: BASE }, data: form({ id }), maxRedirects: 0 });
  expect(r.status()).toBe(403);
});
