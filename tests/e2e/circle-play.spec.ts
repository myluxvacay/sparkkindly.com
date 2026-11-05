import { createHash, randomBytes } from 'node:crypto';
import { test, expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addItem, addTopic, resetExtras, sql } from './helpers/fixtures';

// Circle set and scores (plan 4C Task 3, spec "Done when"): a family of four (two adults, two child profiles) plays the
// daily set on the normal item pages, a child plays through the PIN switch and reads the scores, a friend joins through
// an invite link and appears, a non-member gets 404, and an `adults` item never reaches the family's set.

test.beforeAll(resetExtras);
test.afterAll(resetExtras);

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const PIN = '4826';
const TOPIC = 'Circle play fixture';
let n = 0;
const fresh = () => `e2e-play-${Date.now()}-${n++}@example.test`;

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

async function adult(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${200 + (n++ % 50)}` } });
  const page = await context.newPage();
  const email = fresh();
  await page.goto('/account/sign-up/');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Date of birth').fill('1986-06-06');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  const token = randomBytes(32).toString('hex');
  await sql("INSERT INTO account_login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '15 minutes')", [hash(token), email]);
  await page.goto(`/account/sign-in/link/?token=${token}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/account\/$/);
  return page;
}

async function addProfile(page: Page, name: string, firstPin: boolean) {
  await page.goto('/account/children/');
  await page.getByLabel('First name or nickname').fill(name);
  await page.getByRole('radio', { name: '6 to 9' }).check();
  await page.getByRole('checkbox', { name: /parent or guardian/ }).check();
  if (firstPin) {
    await page.getByLabel('PIN', { exact: true }).fill(PIN);
    await page.getByLabel('PIN again', { exact: true }).fill(PIN);
  }
  await page.getByRole('button', { name: 'Add the profile' }).click();
  await expect(page.getByRole('status')).toContainText('The profile is ready');
}

async function joinByLink(page: Page, path: string, name: string) {
  await page.goto(path);
  await page.getByLabel('Your name in this circle').fill(name);
  await page.getByRole('button', { name: 'Join the circle' }).click();
  await expect(page.getByRole('status')).toContainText('You are in the circle');
}

// Answers the fixture item titled `title` (all fixtures: true/false, answer True) from the set page.
async function answer(page: Page, slug: string, title: string) {
  await page.goto(`/circles/${slug}/set/`);
  await page.getByRole('link', { name: title }).click();
  await page.getByRole('radio', { name: 'True' }).check();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page.getByRole('heading', { name: /^Correct/ })).toBeVisible();
}

test('a family of four plays the daily set, a child reads the scores, a friend joins, a stranger gets 404', async ({ browser }) => {
  await addTopic('e2e-circle-play', TOPIC);
  const body = { mechanic: 'true_false', prompt: 'A prompt that is long enough.', difficulty: 'easy' };
  const answerKey = { value: true, explanation: 'An explanation that is long enough.' };
  for (let i = 1; i <= 5; i++) {
    await addItem({ world: 'play', slug: `e2e-cp-${i}`, kind: 'quiz', title: `Circle quiz ${i}`, body, answer: answerKey, topics: ['e2e-circle-play'] });
  }
  await addItem({ world: 'play', slug: 'e2e-cp-adults', kind: 'quiz', title: 'Circle quiz for adults', audience: 'adults', body, answer: answerKey, topics: ['e2e-circle-play'] });

  // Mum creates the family circle, adds two child profiles and picks the fixture topic before anyone opens the set.
  const mum = await adult(browser);
  await addProfile(mum, 'Mia', true);
  await addProfile(mum, 'Leo', false);
  await mum.goto('/circles/new/');
  await mum.getByLabel('Circle name').fill('The Play Home');
  await mum.getByRole('radio', { name: /^Family:/ }).check();
  await mum.getByLabel('Your name in this circle').fill('Mum');
  await mum.getByRole('button', { name: 'Create the circle' }).click();
  await expect(mum.getByRole('status')).toContainText('Your circle is ready');
  const slug = /\/circles\/([a-z0-9]{10})\//.exec(mum.url())![1];
  for (const child of ['Mia', 'Leo']) {
    await mum.getByLabel('Child profile', { exact: true }).selectOption({ label: child });
    await mum.getByLabel(/everyone in this circle sees this display name/).check();
    await mum.getByRole('button', { name: 'Add to the circle' }).click();
    await expect(mum.getByRole('status')).toContainText('The child profile is in the circle');
  }
  await mum.getByRole('link', { name: "Choose the circle's interests" }).click();
  await axeBothWidths(mum);
  await mum.getByRole('checkbox', { name: TOPIC }).check();
  await mum.getByRole('button', { name: "Save the circle's interests" }).click();
  await expect(mum.getByRole('status')).toContainText("The circle's interests are saved");

  // Dad and a friend join through Mum's invite link.
  await mum.goto(`/circles/${slug}/`);
  await mum.getByRole('button', { name: /^Make (an|a new) invite link$/ }).click();
  const link = new URL(await mum.getByLabel(/Your invite link/).inputValue()).pathname;
  const dad = await adult(browser);
  await joinByLink(dad, link, 'Dad');

  // The set: five child-safe items, as an ordered list with text states; private, no-store.
  const res = await mum.goto(`/circles/${slug}/set/`);
  expect(res!.headers()['cache-control']).toMatch(/private/);
  expect(res!.headers()['cache-control']).toMatch(/no-store/);
  await expect(mum.getByRole('heading', { level: 1, name: /Today's set/ })).toBeVisible();
  const items = mum.getByRole('list').filter({ hasText: 'Circle quiz' }).getByRole('listitem');
  await expect(items).toHaveCount(5);
  await expect(mum.getByText('Circle quiz for adults')).toHaveCount(0);
  await expect(items.first()).toContainText('Not yet');
  await axeBothWidths(mum);

  await answer(mum, slug, 'Circle quiz 1');
  await answer(mum, slug, 'Circle quiz 2');
  await answer(dad, slug, 'Circle quiz 1');
  await mum.goto(`/circles/${slug}/set/`);
  await expect(mum.getByRole('listitem').filter({ hasText: 'Circle quiz 1' })).toContainText('Answered');

  // Mia plays through the PIN switch: the circle URL takes a child to its set.
  await mum.goto('/account/children/');
  await mum.getByRole('button', { name: 'Play as Mia' }).click();
  await expect(mum.getByRole('heading', { level: 1, name: 'Playing as Mia' })).toBeVisible();
  await mum.goto(`/circles/${slug}/`);
  await expect(mum).toHaveURL(new RegExp(`/circles/${slug}/set/$`));
  await expect(mum.getByText('Circle quiz for adults')).toHaveCount(0);
  for (const t of ['Circle quiz 1', 'Circle quiz 2', 'Circle quiz 3']) await answer(mum, slug, t);
  expect((await mum.goto(`/circles/${slug}/interests/`))!.url()).toContain('/account/children/playing/');
  await mum.goto(`/circles/${slug}/scores/`);
  const table = mum.getByRole('table', { name: /Today/ });
  await expect(table.getByRole('row', { name: /Mia \(you\)/ })).toContainText('30');
  await expect(table.getByRole('row', { name: /Mum/ })).toContainText('20');
  await expect(table.getByRole('row', { name: /Dad/ })).toContainText('10');
  await expect(table.getByRole('row', { name: /Leo/ })).toContainText('0');
  await expect(mum.getByText('@example.test')).toHaveCount(0);
  await axeBothWidths(mum);
  await mum.getByRole('link', { name: 'All time' }).click();
  await expect(mum.getByRole('link', { name: 'All time' })).toHaveAttribute('aria-current', 'page');
  await expect(mum.getByRole('table', { name: /All time/ })).toBeVisible();

  // A friend joins through the link and appears on the board; a stranger gets 404 on set and scores.
  const friend = await adult(browser);
  await joinByLink(friend, link, 'Fran');
  await friend.goto(`/circles/${slug}/scores/`);
  await expect(friend.getByRole('row', { name: /Fran \(you\)/ })).toBeVisible();
  const stranger = await adult(browser);
  for (const p of ['set', 'scores', 'interests']) expect((await stranger.goto(`/circles/${slug}/${p}/`))!.status(), p).toBe(404);
});
