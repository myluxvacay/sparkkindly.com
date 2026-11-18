import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { addItem, resetExtras } from './helpers/fixtures';

test.beforeEach(resetExtras);
test.afterAll(resetExtras);

const starters = fs
  .readdirSync('content/quizzes')
  .map((f) => JSON.parse(fs.readFileSync(`content/quizzes/${f}`, 'utf8')) as { id: string; brand: string; reviewStatus: string; scheduledDate: string })
  .filter((q) => q.reviewStatus === 'approved')
  // The archive lists published quizzes only: a quiz appears on its scheduled date, and the seed library now
  // schedules quizzes months ahead, so not-yet-due quizzes are excluded here just as the archive excludes them.
  .filter((q) => q.scheduledDate <= new Date().toISOString().slice(0, 10));

test('/quiz/ shows the latest quiz with an answer form and canonical to its item page', async ({ page }) => {
  await page.goto('/quiz/');
  await expect(page.getByRole('radio').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Check answer/ })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:\/\/sparkkindly\.com\/[a-z]+\/[a-z0-9-]+\/$/);
});

test('answering from /quiz/ lands on the item page with the verdict', async ({ page }) => {
  await page.goto('/quiz/');
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page.getByRole('status')).toContainText(/Correct|Not quite/);
});

test('the archive links every published starter quiz across its pages', async ({ page }) => {
  const seen = new Set<string>();
  for (let n = 1; n <= 60; n++) {
    await page.goto(`/quiz/archive/?page=${n}`);
    for (const h of await page.locator('main a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))) seen.add(h);
    if ((await page.getByRole('link', { name: /Older/ }).count()) === 0) break;
  }
  // Quiz cards are play-intent entries: their links carry the play panel's fragment so the visitor
  // lands on the question, not the article header (owner phone report, 17 Nov 2026).
  for (const q of starters) expect(seen, q.id).toContain(`/${q.brand}/${q.id}/#play-panel`);
});

const focusQuiz = {
  world: 'play',
  slug: 'fx-focus-quiz',
  kind: 'quiz' as const,
  title: 'Focus fixture quiz',
  body: { mechanic: 'true_false', prompt: 'A prompt that is long enough.', difficulty: 'easy' },
  answer: { value: true, explanation: 'An explanation that is long enough.' },
};

test('a #play-panel arrival lands on the question panel at phone width, with and without JS', async ({ page, browser }) => {
  await addItem(focusQuiz);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/play/fx-focus-quiz/#play-panel');
  // The native anchor scroll (plus the global scroll-padding) settles the panel near the viewport top.
  await expect
    .poll(() => page.evaluate(() => Math.round(document.querySelector('.quiz-panel')!.getBoundingClientRect().top)))
    .toBeLessThan(160);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

  // The no-JavaScript path is the same native anchor — no script may be required to land on the panel.
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const plain = await noJs.newPage();
  await plain.goto('/play/fx-focus-quiz/#play-panel');
  await expect
    .poll(() => plain.evaluate(() => Math.round(document.querySelector('.quiz-panel')!.getBoundingClientRect().top)))
    .toBeLessThan(160);
  await noJs.close();
});

test('a plain quiz visit has no blank band between the byline and the panel', async ({ page }) => {
  await addItem(focusQuiz);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/play/fx-focus-quiz/');
  const gap = await page.evaluate(() => {
    const byline = document.querySelector('.byline')!.getBoundingClientRect();
    const panel = document.querySelector('.quiz-panel')!.getBoundingClientRect();
    return Math.round(panel.top - byline.bottom);
  });
  // Byline margin + heading padding + a breath of panel margin; the stacked section padding is gone.
  expect(gap).toBeGreaterThan(0);
  expect(gap).toBeLessThan(75);
});

test('the Spark flick zone navigates on a flick, and a drag elsewhere still scrolls', async ({ browser }) => {
  await addItem(focusQuiz);
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
      modifiers: 0,
    });
  };
  const drag = async (x: number, fromY: number, toY: number, steps: number, stepMs: number) => {
    await touch('touchStart', x, fromY);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', x, fromY + ((toY - fromY) * i) / steps);
      await page.waitForTimeout(stepMs);
    }
    await touch('touchEnd', x, toY);
  };

  await page.goto('/play/fx-focus-quiz/');
  // A slow drag starting on the article summary (outside the zone) scrolls the page as always.
  const before = await page.evaluate(() => window.scrollY);
  await drag(195, 500, 260, 6, 60);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 40);

  // Answer the fixture; the keep-playing block (with the Spark flick zone) arrives with the verdict.
  await page.locator('.quiz-panel').scrollIntoViewIfNeeded();
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: /Check answer/ }).click();
  const zone = page.locator('[data-kp-flick]');
  await expect(zone).toBeVisible();
  await zone.scrollIntoViewIfNeeded();
  const box = (await zone.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // A fast flick up on Spark: harder — the island navigates to another quiz, fragment and all.
  await drag(cx, cy + 10, cy - 110, 3, 25);
  await page.waitForURL((url) => url.pathname !== '/play/fx-focus-quiz/' && url.hash === '#play-panel', { timeout: 10_000 });
  await context.close();
});

test('a wrong answer keeps the quiz on screen, and Next hops quiz to quiz without getting stuck', async ({ page, browser }) => {
  // User feedback (17 Nov 2026): a wrong answer felt like being taken away to an explanation, and
  // choosing Next sometimes left the quiz or stalled. Tested against the current build, JS and no-JS,
  // at phone width: the verdict must arrive inside the same panel with the question and the player's
  // own answer kept, and repeated keep-playing hops must keep landing on fresh questions.
  await addItem(focusQuiz);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/play/fx-focus-quiz/');
  await page.getByRole('radio').nth(1).check(); // the fixture's answer is True; this picks False
  await page.getByRole('button', { name: /Check answer/ }).click();
  const panel = page.locator('.quiz-panel');
  await expect(panel.getByRole('status')).toContainText('Not quite');
  // Still the same page, still the same panel: question, your pick and the correct one are all here.
  await expect(page).toHaveURL(/\/play\/fx-focus-quiz\//);
  await expect(panel.locator('.quiz-review-prompt')).toHaveText('A prompt that is long enough.');
  await expect(panel.locator('.quiz-review-option.is-yours')).toContainText('False');
  await expect(panel.locator('.quiz-review-option.is-yours')).toContainText('Your answer');
  await expect(panel.locator('.quiz-review-option.is-correct')).toContainText('True');
  await expect(panel.locator('.quiz-explain')).toContainText('An explanation that is long enough.');

  // Hop twice with the keep-playing buttons: each time a different quiz, a fresh form, panel on top.
  let here = page.url();
  for (let hop = 0; hop < 2; hop++) {
    await page.getByRole('link', { name: /Play another at this level/ }).click();
    await page.waitForURL((url) => url.toString() !== here && url.hash === '#play-panel', { timeout: 10_000 });
    here = page.url();
    await expect(page.getByRole('radio').first()).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Math.round(document.querySelector('.quiz-panel')!.getBoundingClientRect().top)))
      .toBeLessThan(160);
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: /Check answer/ }).click();
    await expect(page.locator('.quiz-panel').getByRole('status')).toContainText(/Correct|Not quite/);
  }

  // The no-JavaScript path: the form reloads the same item page, the kept context is server-rendered,
  // and the keep-playing links (plain hrefs) hop onward the same way.
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const plain = await noJs.newPage();
  await plain.goto('/play/fx-focus-quiz/');
  await plain.getByRole('radio').nth(1).check();
  await plain.getByRole('button', { name: /Check answer/ }).click();
  await expect(plain).toHaveURL(/\/play\/fx-focus-quiz\/\?r=false#result$/);
  await expect(plain.locator('.quiz-review-option.is-yours')).toContainText('False');
  await expect(plain.locator('.quiz-explain')).toContainText('An explanation that is long enough.');
  await plain.getByRole('link', { name: /Play another at this level/ }).click();
  await plain.waitForURL((url) => !url.pathname.endsWith('/play/fx-focus-quiz/') && url.hash === '#play-panel', { timeout: 10_000 });
  await expect(plain.getByRole('radio').first()).toBeVisible();
  await noJs.close();
});

test('the archive is newest first and tolerates bad page numbers', async ({ page }) => {
  await addItem({ world: 'play', slug: 'fx-newest-quiz', kind: 'quiz', title: 'Newest fixture quiz', publishedAt: 'now()', body: { mechanic: 'true_false', prompt: 'A prompt that is long enough.', difficulty: 'easy' }, answer: { value: true, explanation: 'An explanation that is long enough.' } });
  await page.goto('/quiz/archive/');
  await expect(page.locator('main h2 a, main h3 a').first()).toHaveText('Newest fixture quiz');
  for (const q of ['-1', 'abc']) expect((await page.goto(`/quiz/archive/?page=${q}`))?.status(), q).toBe(200);
  expect((await page.goto('/quiz/archive/?page=999999'))?.status()).toBe(404); // SEO audit M3: past the end
});

test('an old quiz id redirects permanently to its item page', async ({ request }) => {
  const q = starters[0];
  const res = await request.get(`/quiz/${q.id}/`, { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers()['location']).toMatch(new RegExp(`/${q.brand}/${q.id}/$`));
});

test('an unknown or draft quiz id is not found', async ({ request }) => {
  await addItem({ world: 'play', slug: 'fx-draft-quiz', kind: 'quiz', status: 'draft' });
  for (const id of ['no-such-quiz', 'fx-draft-quiz']) {
    expect((await request.get(`/quiz/${id}/`, { maxRedirects: 0 })).status(), id).toBe(404);
  }
});
