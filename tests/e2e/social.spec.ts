import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addItem, sql } from './helpers/fixtures';
import { session, signInContext } from './helpers/admin';
import { generateKey } from '../../lib/agents/keys';
import { runPoster } from '../../lib/social/poster';
import type { Queryable } from '../../lib/db';

// Social distribution (plan 5A Task 4). The preview server on 4173 runs with SOCIAL_ENABLED; the server on 4174 has no
// flags. The owner switches Facebook on and hand-picks an item in /admin/social/; the promotion agent's copy goes through
// the real route handlers with a promoter key; the poster runs here against an injected fake Meta (no request leaves the
// machine) and the post shows as posted with its link. Unpublishing cancels a pending post. A Kids item is refused.

const OFF = 'http://localhost:4174';
const stamp = Date.now();
const ITEM = `e2e-social-${stamp}`;
const PENDING = `e2e-social-pending-${stamp}`;
const KIDS = `e2e-social-kids-${stamp}`;
const META_ENV = { META_PAGE_ACCESS_TOKEN: 'e2e-fake-token', META_PAGE_ID: '111', META_IG_USER_ID: '222' };
const db: Queryable = {
  query: async (text, params) => {
    const r = await sql(text, params);
    return { rows: r.rows as never[], rowCount: r.rowCount };
  },
  exec: async (text) => {
    await sql(text);
  },
};
let itemId = '';
let pendingId = '';
let kidsId = '';
let promoterKey = '';

const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
};

async function owner(browser: import('@playwright/test').Browser): Promise<Page> {
  const ctx = await browser.newContext();
  await signInContext(ctx, await session());
  return ctx.newPage();
}

test.beforeAll(async () => {
  process.env.SOCIAL_ENABLED = 'true'; // the poster below runs in this process, as the worker would on the VM
  itemId = await addItem({ world: 'discover', slug: ITEM, title: 'Why the sky looks blue' });
  pendingId = await addItem({ world: 'grow', slug: PENDING, title: 'A small step for today' });
  kidsId = await addItem({ world: 'kids', slug: KIDS, title: 'Kids shadow game' });
  const { key, prefix, hash } = generateKey();
  await sql("INSERT INTO agents (name, key_prefix, key_hash, role) VALUES ($1, $2, $3, 'promoter')", [`e2e-promoter-${stamp}`, prefix, hash]);
  promoterKey = key;
});
test.afterAll(async () => {
  await sql('DELETE FROM distributions WHERE item_id = ANY($1::uuid[])', [[itemId, pendingId, kidsId]]);
  await sql("UPDATE social_platforms SET enabled = false, daily_cap = CASE platform WHEN 'instagram' THEN 2 WHEN 'facebook' THEN 3 ELSE 1 END");
});

test('with the flag off the promotion routes do not exist', async ({ request }) => {
  expect((await request.get(`${OFF}/api/agent/promotions/`, { headers: { 'x-agent-key': promoterKey } })).status()).toBe(404);
});

test('select, copy, schedule and post to Facebook; the post shows with its link; unpublish cancels; Kids is refused', async ({ browser, request }) => {
  const admin = await owner(browser);
  await admin.goto('/admin/social/');
  await expect(admin.getByRole('heading', { name: 'Social', level: 1 })).toBeVisible();
  await admin.getByLabel('Posting', { exact: true }).nth(1).selectOption('true');
  await admin.getByLabel('Posts a day (0 to 10)').nth(1).fill('3');
  await admin.getByLabel('Posting time (UTC, by 20:00)').nth(1).fill('00:00');
  await admin.getByRole('button', { name: 'Save Facebook' }).click();
  await expect(admin.getByRole('status')).toContainText('Platform settings saved');
  // The site's own server has no Meta credentials (only the worker would): the banner names Facebook, not Instagram (off).
  await expect(admin.getByText(/No credentials for Facebook/)).toBeVisible();
  await expect(admin.getByText(/No credentials for Instagram/)).toHaveCount(0);

  for (const [id, done] of [[itemId, 'Item picked'], [pendingId, 'Item picked'], [kidsId, 'cannot go to social media']] as const) {
    await admin.getByLabel('Item id').fill(id);
    await admin.getByLabel('Platform', { exact: true }).selectOption('facebook');
    await admin.getByRole('button', { name: 'Pick for today' }).click();
    await expect(id === kidsId ? admin.getByRole('alert').filter({ hasText: done }) : admin.getByRole('status')).toContainText(done);
  }

  const queue = await request.get('/api/agent/promotions/', { headers: { 'x-agent-key': promoterKey } });
  expect(queue.status()).toBe(200);
  const { entries } = (await queue.json()) as { entries: { id: number; version: number; data: { title: string } }[] };
  expect(entries.map((e) => e.data.title)).not.toContain('Kids shadow game');
  const entry = entries.find((e) => e.data.title === 'Why the sky looks blue')!;
  const refused = await request.post('/api/agent/promotions/copy/', {
    headers: { 'x-agent-key': promoterKey },
    data: { id: entry.id, version: entry.version, caption: 'See evil.example now', hashtags: [] },
  });
  expect(refused.status()).toBe(400);
  const copy = await request.post('/api/agent/promotions/copy/', {
    headers: { 'x-agent-key': promoterKey },
    data: { id: entry.id, version: entry.version, caption: 'Why is the sky blue and not violet?', hashtags: ['science', 'curiosity'] },
  });
  expect(copy.status()).toBe(200);
  expect(await copy.json()).toEqual({ status: 'scheduled' });

  const due = (await sql<{ scheduled_for: Date }>('SELECT scheduled_for FROM distributions WHERE id = $1', [entry.id])).rows[0].scheduled_for;
  const sent: { url: string; body: string; auth: string | null }[] = [];
  const fakeMeta = (async (url: string | URL, init?: RequestInit) => {
    sent.push({ url: String(url), body: String(init?.body), auth: new Headers(init?.headers).get('authorization') });
    return Response.json({ id: 'P1', post_id: `111_${stamp}` });
  }) as typeof fetch;
  const result = await runPoster(db, new Date(new Date(due).getTime() + 1000), { env: META_ENV, fetch: fakeMeta });
  expect(result).toMatchObject({ posted: 1, failed: 0 });
  expect(sent).toHaveLength(1);
  expect(sent[0].url).toBe('https://graph.facebook.com/v21.0/111/photos');
  expect(sent[0].url).not.toContain('token');
  const message = new URLSearchParams(sent[0].body).get('message')!;
  expect(message).toContain('Why is the sky blue and not violet?');
  expect(message).toContain(`/discover/${ITEM}/?utm_source=facebook&utm_medium=social&utm_campaign=discover-${ITEM}`);
  expect(message).toContain('#science #curiosity');

  // A visitor arriving from the post: counted in aggregate, the page itself unchanged.
  const plain = await (await request.get(`/discover/${ITEM}/`)).text();
  const fromSocial = await request.get(`/discover/${ITEM}/?utm_source=facebook&utm_medium=social`);
  expect(fromSocial.status()).toBe(200);
  expect(fromSocial.headers()['set-cookie']).toBeUndefined();
  const h1 = (html: string) => /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1];
  expect(h1(await fromSocial.text())).toBe(h1(plain));
  expect((await sql('SELECT visits FROM social_visits WHERE item_id = $1 AND platform = $2', [itemId, 'facebook'])).rows[0]).toEqual({ visits: 1 });

  await admin.goto(`/admin/items/${pendingId}/`);
  await admin.getByRole('button', { name: 'Unpublish' }).click();
  await expect(admin.getByRole('status')).toContainText('Unpublished.');

  await admin.goto('/admin/social/');
  const posted = admin.getByRole('listitem').filter({ hasText: 'Why the sky looks blue' }).filter({ hasText: 'facebook' }).first();
  await expect(posted).toContainText('posted');
  await expect(posted.getByRole('link', { name: 'view post' })).toHaveAttribute('href', `https://www.facebook.com/111_${stamp}`);
  await expect(admin.getByRole('listitem').filter({ hasText: 'A small step for today' }).first()).toContainText('cancelled');
  await expect(admin.getByText('Kids shadow game')).toHaveCount(0);
  await expect(admin.getByRole('listitem').filter({ hasText: 'Why the sky looks blue' }).filter({ hasText: 'visit' }).first()).toContainText('1 visit');

  expect(await axe(admin)).toEqual([]);
  await admin.setViewportSize({ width: 320, height: 800 });
  expect(await axe(admin)).toEqual([]);
  expect(await admin.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('the share image is a JPEG for an eligible item and 404 for Kids', async ({ request }) => {
  const ok = await request.get(`/api/template-image/discover/${ITEM}/?format=social`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()['content-type']).toBe('image/jpeg');
  const bytes = await ok.body();
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  expect((await request.get(`/api/template-image/kids/${KIDS}/?format=social`)).status()).toBe(404);
});
