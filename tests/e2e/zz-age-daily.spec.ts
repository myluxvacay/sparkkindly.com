// TEMPORARY verification spec for the age-band build — not committed.
// Chain order by publish time: A (family) > D (9-12) > B (3-5) > C (3-5).
// T1 (no band): answer the daily -> return -> the NEXT question in chain order loads (D), never A again.
// T2 (band 3-5): the family daily stays on first load (family suits every band by design);
// after answering it, the advance is band-first — B (3-5) loads ahead of the newer D (9-12);
// after answering B, a return visit loads C — an answered question never re-serves.
import { test, expect } from '@playwright/test';
import { addItem, resetExtras } from './helpers/fixtures';

test.beforeEach(resetExtras);
test.afterAll(resetExtras);

const opts = [
  { id: 'a', text: 'Alpha option' },
  { id: 'b', text: 'Bravo option' },
  { id: 'c', text: 'Charlie option' },
  { id: 'd', text: 'Delta option' },
];
const body = {
  mechanic: 'multiple_choice',
  prompt: 'A prompt that is long enough to be valid.',
  difficulty: 'easy',
  options: opts,
};

async function addChain() {
  const mk = (slug: string, topics: string[] | undefined, mins: number) =>
    addItem({
      world: 'play', slug, kind: 'quiz', title: `ZZ ${slug}`,
      body, answer: { value: 'b', explanation: 'Bravo is right.' },
      topics, publishedAt: `now() - interval '${mins} minutes'`,
    });
  const a = await mk('zz-daily-a', undefined, 1);
  const d = await mk('zz-daily-d', ['ages-9-12'], 2);
  const b = await mk('zz-daily-b', ['ages-3-5'], 3);
  const c = await mk('zz-daily-c', ['ages-3-5'], 4);
  return { a, b, c, d };
}

const current = async (page: import('@playwright/test').Page) =>
  page.locator('[data-daily-current]').first().getAttribute('data-daily-current');

async function answerCurrent(page: import('@playwright/test').Page) {
  await page.getByRole('radio', { name: /Bravo option/ }).check();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page.getByRole('status')).toContainText(/Correct|Not quite/);
}

test('T1: answering the daily question, then returning, loads another question', async ({ page }) => {
  const { a, d } = await addChain();
  await page.goto('/quiz/');
  await expect.poll(() => current(page), { timeout: 15_000 }).toBe(a);
  await answerCurrent(page);
  await page.goto('/quiz/');
  await expect.poll(() => current(page), { timeout: 15_000 }).toBe(d);
});

test('T2: band 3-5 — advance is band-first and answered questions never re-serve', async ({ browser }) => {
  const { a, b, c, d } = await addChain();
  const context = await browser.newContext({
    storageState: {
      cookies: [],
      origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'sk-age-band', value: '3-5' }] }],
    },
  });
  const page = await context.newPage();
  await page.goto('/quiz/');
  // Family suits every band: the served daily stays (no swap), settled after island init.
  await page.waitForTimeout(2500);
  expect(await current(page)).toBe(a);
  await answerCurrent(page);
  // Band-first advance: B (3-5) ahead of the newer D (9-12).
  await page.goto('/quiz/');
  await expect.poll(() => current(page), { timeout: 15_000 }).toBe(b);
  expect(await current(page)).not.toBe(d);
  await answerCurrent(page);
  // Return visit: B answered — the slot loads C, never B or A again.
  await page.goto('/');
  await page.goto('/quiz/');
  await expect.poll(() => current(page), { timeout: 15_000 }).toBe(c);
  await context.close();
});
