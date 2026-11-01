import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addItem, resetExtras, sql } from './helpers/fixtures';
import { FORM, ORIGIN, cookieHeader, csrfFor, form, session, signInContext } from './helpers/admin';

// The owner's walkthrough of the admin area, through the real pages and the single action route.

const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
};

test.beforeEach(async ({ context }) => {
  await signInContext(context, await session());
});
test.afterAll(async () => {
  await resetExtras();
  await sql("DELETE FROM agents WHERE name LIKE 'e2e-%'");
  await sql("DELETE FROM topics WHERE slug LIKE 'e2e-%'");
});

test('approve a Kids item from the queue, by keyboard; it is scheduled with the owner as approver', async ({ page }) => {
  const id = await addItem({ world: 'kids', slug: 'e2e-kids-waiting', title: 'E2E kids waiting', audience: 'kids', status: 'in_review', publishedAt: null });
  await sql('UPDATE items SET approved_by = NULL, risk_tier = $2 WHERE id = $1', [id, 'kids']);
  await page.goto('/admin/');
  expect(await axe(page)).toEqual([]);
  await page.getByRole('button', { name: 'Approve: E2E kids waiting' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Approved and scheduled.');
  const row = (await sql<{ status: string; approved_by: string; future: boolean }>('SELECT status, approved_by, publish_at > now() AS future FROM items WHERE id = $1', [id])).rows[0];
  expect(row).toEqual({ status: 'scheduled', approved_by: 'owner@example.test', future: true });
});

test('unpublish a live item from its admin page; the public page is gone at once', async ({ page }) => {
  const id = await addItem({ world: 'discover', slug: 'e2e-live', title: 'E2E live item' });
  expect((await page.request.get('/discover/e2e-live/')).status()).toBe(200);
  await page.goto(`/admin/items/${id}/`);
  expect(await axe(page)).toEqual([]);
  await page.getByRole('button', { name: 'Unpublish' }).click();
  await expect(page.getByRole('status')).toContainText('Unpublished.');
  expect((await page.request.get('/discover/e2e-live/')).status()).toBe(404);
});

test('the items list and the new-article form pass axe; the owner publishes an article that shows on the site', async ({ page }) => {
  await page.goto('/admin/items/');
  expect(await axe(page)).toEqual([]);
  await page.goto('/admin/items/new/');
  expect(await axe(page)).toEqual([]);
  await page.getByLabel('World').selectOption('grow');
  await page.getByLabel('Title').fill('E2E owner article');
  await page.getByLabel(/Address/).fill('e2e-owner-article');
  await page.getByLabel('Summary').fill('Written by the owner in the admin area.');
  await page.getByLabel(/Text/).fill('First paragraph.\n\nSecond paragraph.');
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('status')).toContainText('Published.');
  await page.goto('/grow/e2e-owner-article/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E owner article');
  await sql("UPDATE items SET created_by = 'e2e' WHERE slug = 'e2e-owner-article'");
});

test('close a problem report from the reports page', async ({ page }) => {
  const id = await addItem({ world: 'play', slug: 'e2e-reported', title: 'E2E reported item' });
  await sql("INSERT INTO problem_reports (item_id, reason, message) VALUES ($1, 'wrong', '<b>e2e markup stays text</b>')", [id]);
  await page.goto('/admin/reports/');
  expect(await axe(page)).toEqual([]);
  await expect(page.getByText('<b>e2e markup stays text</b>')).toBeVisible();
  await page.getByRole('button', { name: 'Close report on: E2E reported item' }).click();
  await expect(page.getByRole('status')).toContainText('Report closed.');
  expect((await sql("SELECT status FROM problem_reports WHERE item_id = $1", [id])).rows).toEqual([{ status: 'closed' }]);
});

test('a world named after a page is refused with a readable error', async ({ page }) => {
  await page.goto('/admin/worlds/');
  expect(await axe(page)).toEqual([]);
  await page.getByLabel(/Address/).fill('admin');
  await page.getByLabel('Name', { exact: true }).last().fill('Admin world');
  await page.getByRole('button', { name: 'Add world' }).click();
  await expect(page.getByRole('alert')).toContainText('page name on the site');
});

test("rotating an agent's key shows the new key once; the old key is refused and another agent's key still works", async ({ page }) => {
  await page.goto('/admin/agents/');
  expect(await axe(page)).toEqual([]);
  const create = async (name: string, world: string) => {
    await page.goto('/admin/agents/');
    await page.getByLabel(/^Name/).fill(name);
    await page.getByLabel('World').selectOption(world);
    await page.getByRole('button', { name: 'Create agent' }).click();
    return (await page.locator('code').textContent())!.trim();
  };
  const keyA = await create('e2e-agent-a', 'play');
  const keyB = await create('e2e-agent-b', 'grow');
  const brief = (key: string, world: string) => page.request.get(`/api/agent/brief/?world=${world}`, { headers: { 'x-agent-key': key } });
  expect((await brief(keyA, 'play')).status()).toBe(200);
  await page.goto('/admin/agents/');
  await page.getByRole('button', { name: 'Rotate key: e2e-agent-a' }).click();
  const fresh = (await page.locator('code').textContent())!.trim();
  expect(fresh).toMatch(/^skagt_[0-9a-f]{8}_[0-9a-f]{48}$/);
  expect(fresh).not.toBe(keyA);
  expect((await brief(keyA, 'play')).status()).toBe(401);
  expect((await brief(fresh, 'play')).status()).toBe(200);
  expect((await brief(keyB, 'grow')).status()).toBe(200);
  expect((await brief(keyB, 'play')).status()).toBe(403);
  const audit = JSON.stringify((await sql('SELECT detail, target FROM audit_log')).rows);
  expect(audit).not.toContain(fresh);
  expect(audit).not.toContain(keyB);
});

test('a return address off the admin area is ignored, and the topics, runs and digest pages pass axe', async ({ page }) => {
  const s = await session();
  const r = await page.request.post('/admin/act/', {
    headers: { ...FORM, ...ORIGIN, ...cookieHeader(s) },
    data: form({ csrf: csrfFor(s), action: 'topic.create', slug: 'e2e-return', name: 'E2E return', return: '//evil.example/' }),
    maxRedirects: 0,
  });
  expect(r.status()).toBe(303);
  expect(r.headers().location).toMatch(/^\/admin\/\?done=/);
  for (const path of ['/admin/topics/', '/admin/runs/', '/admin/digest/']) {
    await page.goto(path);
    expect(await axe(page), path).toEqual([]);
  }
});

test('the queue reflows at 320px without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const path of ['/admin/', '/admin/items/', '/admin/agents/']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
