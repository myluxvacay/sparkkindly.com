import { createHash, randomBytes } from 'node:crypto';
import { test, expect, type Browser, type Page, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { activeModerator, addItem, sql } from './helpers/fixtures';
import { BASE, session, signInContext } from './helpers/admin';
import { generateKey } from '../../lib/agents/keys';
import { appealToken } from '../../lib/comments/appeals';

// Comment moderation (plan 7B Task 4) against the preview server (ACCOUNTS_ENABLED and COMMENTS_ENABLED on). The
// moderation agent is played by this spec calling the real agent routes with a test moderation key; no model runs.
// There is no mail sink in this harness (ruling): the rejection email's appeal link is minted here with the same
// test-only UNSUBSCRIBE_SECRET the preview server uses (playwright.config.ts), exactly as the server mints it.

const SECRET = 'e2e-test-only-unsubscribe-secret-not-real-0001';
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

async function member(browser: Browser, level: 0 | 1 = 0): Promise<{ page: Page; id: string; token: string }> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${(n = n + 1) % 250}` } });
  const page = await context.newPage();
  const email = `e2e-mod-${stamp}-${n}@example.test`;
  await page.goto('/account/sign-up/');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Date of birth').fill(dobYearsAgo(30));
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  const link = randomBytes(32).toString('hex');
  await sql("INSERT INTO account_login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '15 minutes')", [hash(link), email]);
  await page.goto(`/account/sign-in/link/?token=${link}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/account\/$/);
  const id = (await sql('SELECT id FROM accounts WHERE email = $1', [email])).rows[0].id as string;
  await sql(
    `INSERT INTO account_trust (account_id, level, display_name, guidelines_accepted_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (account_id) DO UPDATE SET level = EXCLUDED.level`,
    [id, level, `Mod${n}`],
  );
  const token = (await context.cookies(BASE)).find((c) => c.name === '__Host-sk_account')!.value;
  return { page, id, token };
}

async function moderationKey(): Promise<string> {
  const { key, prefix, hash: h } = generateKey();
  await sql("INSERT INTO agents (name, key_prefix, key_hash, role) VALUES ($1, $2, $3, 'moderation')", [`e2e-moderator-${stamp}`, prefix, h]);
  return key;
}

type Entry = { id: string; version: string; reason: string };
async function queued(request: APIRequestContext, key: string, id: string): Promise<Entry> {
  const r = await request.get('/api/agent/moderation/', { headers: { 'x-agent-key': key } });
  expect(r.status()).toBe(200);
  const entry = ((await r.json()).comments as Entry[]).find((c) => c.id === id);
  expect(entry, 'queued').toBeTruthy();
  return entry!;
}
async function decide(request: APIRequestContext, key: string, id: string, decision: string, reason?: string) {
  const e = await queued(request, key, id);
  const r = await request.post('/api/agent/moderation/decide/', { headers: { 'x-agent-key': key }, data: { id, version: e.version, decision, reason, ...(['reject', 'hide'].includes(decision) ? { code: 'abuse' } : {}) } });
  expect(r.status(), await r.text()).toBe(200);
}

async function post(page: Page, body: string) {
  await page.getByLabel('Your comment', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Post comment' }).click();
}
const said = (page: Page, text: string) => page.locator('#comments .comment-body', { hasText: text });
const commentId = async (accountId: string, body: string) =>
  (await sql('SELECT id FROM comments WHERE account_id = $1 AND body = $2', [accountId, body])).rows[0].id as string;
const statusOf = async (id: string) => (await sql('SELECT status FROM comments WHERE id = $1', [id])).rows[0].status as string;

async function report(page: Page, url: string, body: string, urgent = false) {
  await page.goto(url);
  const li = page.locator('#comments li.comment', { hasText: body });
  await li.getByText('Report', { exact: true }).click();
  await li.getByLabel('Why are you reporting this comment?').selectOption('abuse');
  if (urgent) await li.getByLabel(/Urgent: someone may be in danger/).check();
  await li.getByRole('button', { name: 'Send report' }).click();
}

test.beforeEach(async () => {
  await activeModerator();
});

test('held, approved by the agent, reported, hidden, kept, urgently hidden, rejected, appealed and overturned', async ({ browser, request }) => {
  const slug = `e2e-moderation-${stamp}`;
  await addItem({ world: 'play', slug, title: 'Moderation fixture' });
  const url = `/play/${slug}/`;
  const key = await moderationKey();
  const anon = await (await browser.newContext()).newPage();

  // A level-0 member's comment is held, then approved through the agent API, and appears.
  const author = await member(browser, 0);
  await author.page.goto(url);
  await post(author.page, `Held then approved ${stamp}`);
  await expect(author.page.locator('#result')).toContainText('waiting for review');
  const held = await commentId(author.id, `Held then approved ${stamp}`);
  await decide(request, key, held, 'approve');
  await anon.goto(url);
  await expect(said(anon, `Held then approved ${stamp}`)).toBeVisible();

  // Two level-1 members' reports hide it; the agent's keep restores it.
  const r1 = await member(browser, 1);
  const r2 = await member(browser, 1);
  await report(r1.page, url, `Held then approved ${stamp}`);
  await expect(r1.page.locator('#result')).toContainText('report has been received');
  await r2.page.goto(url);
  await r2.page.locator('#comments li.comment', { hasText: `Held then approved ${stamp}` }).getByText('Report', { exact: true }).click();
  await axeBothWidths(r2.page);
  await report(r2.page, url, `Held then approved ${stamp}`);
  await expect(r2.page.locator('#result')).toContainText('hidden while it is reviewed');
  await anon.goto(url);
  await expect(said(anon, `Held then approved ${stamp}`)).toHaveCount(0);
  await decide(request, key, held, 'keep');
  await anon.goto(url);
  await expect(said(anon, `Held then approved ${stamp}`)).toBeVisible();

  // An urgent report from a level-1 member hides another comment at once.
  const writer = await member(browser, 1);
  await writer.page.goto(url);
  await post(writer.page, `Urgent target ${stamp}`);
  await expect(writer.page.locator('#result')).toContainText('published');
  const r3 = await member(browser, 1);
  await report(r3.page, url, `Urgent target ${stamp}`, true);
  await expect(r3.page.locator('#result')).toContainText('hidden while it is reviewed');
  expect(await statusOf(await commentId(writer.id, `Urgent target ${stamp}`))).toBe('hidden');

  // The agent rejects a held comment; the author files an appeal from the emailed link; the owner overturns it.
  await author.page.goto(url);
  await sql('UPDATE account_trust SET level = 0 WHERE account_id = $1', [author.id]);
  await post(author.page, `Rejected then restored ${stamp}`);
  const rejected = await commentId(author.id, `Rejected then restored ${stamp}`);
  await decide(request, key, rejected, 'reject', 'Off topic for this item');
  expect(await statusOf(rejected)).toBe('rejected');
  const token = appealToken(SECRET, rejected, author.id, new Date())!;
  await author.page.goto(`/comments/appeal/${token}/`);
  await expect(author.page.getByRole('heading', { level: 1, name: 'Appeal a comment decision' })).toBeVisible();
  await axeBothWidths(author.page);
  await author.page.getByLabel(/Why should it be shown/).fill('It answers the question in the item.');
  await author.page.getByRole('button', { name: 'Send appeal' }).click();
  await expect(author.page.getByRole('heading', { level: 1, name: 'Your appeal is sent' })).toBeVisible();

  const owner = await browser.newContext();
  await signInContext(owner, await session());
  const admin = await owner.newPage();
  await admin.goto('/admin/comments/');
  await expect(admin.getByText('Off topic for this item').first()).toBeVisible();
  await expect(admin.getByText('Response target: within 48 hours').first()).toBeVisible();
  expect(await admin.content()).not.toContain('e2e-mod-');
  await admin.setViewportSize({ width: 320, height: 800 });
  expect(await axe(admin)).toEqual([]);
  await admin.setViewportSize({ width: 1280, height: 720 });
  await admin.getByRole('button', { name: /^Overturn: appeal/ }).first().click();
  await expect(admin.getByText('Appeal overturned')).toBeVisible();
  await anon.goto(url);
  await expect(said(anon, `Rejected then restored ${stamp}`)).toBeVisible();
  await owner.close();
});

test('a child profile sees no comments and no report forms', async ({ browser }) => {
  const slug = `e2e-moderation-child-${stamp}`;
  await addItem({ world: 'play', slug, title: 'Moderation child fixture' });
  const writer = await member(browser, 1);
  await writer.page.goto(`/play/${slug}/`);
  await post(writer.page, `Visible to adults ${stamp}`);
  const parent = await member(browser, 1);
  await parent.page.goto(`/play/${slug}/`);
  await expect(parent.page.locator('form[action="/comments/report/"]')).toHaveCount(1);
  const kid = (await sql("INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, 'Mo', '6-9') RETURNING id", [parent.id])).rows[0].id;
  await sql('UPDATE account_sessions SET active_profile_id = $1 WHERE token_hash = $2', [kid, hash(parent.token)]);
  await parent.page.goto(`/play/${slug}/`);
  await expect(parent.page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(parent.page.locator('#comments')).toHaveCount(0);
  expect(await parent.page.content()).not.toContain('/comments/report/');
  expect(await parent.page.content()).not.toContain(`Visible to adults ${stamp}`);
});

test('the moderation routes refuse a missing key and content keys; with the flags off they are 404', async ({ request }) => {
  expect((await request.get('/api/agent/moderation/')).status()).toBe(401);
  const { key, prefix, hash: h } = generateKey();
  await sql('INSERT INTO agents (name, key_prefix, key_hash) VALUES ($1, $2, $3)', [`e2e-content-${stamp}`, prefix, h]);
  const r = await request.get('/api/agent/moderation/', { headers: { 'x-agent-key': key } });
  expect([r.status(), await r.json()]).toEqual([403, { error: 'forbidden_role' }]);
  expect((await request.get('http://localhost:4174/api/agent/moderation/', { headers: { 'x-agent-key': key } })).status()).toBe(404);
});
