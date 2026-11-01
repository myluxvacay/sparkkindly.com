import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addItem, addTopic, resetExtras } from './helpers/fixtures';

// Project 1D, Task 2: accessibility sign-off. axe over every public page and state (all impacts, not only serious),
// then the checks automation cannot do: keyboard-only play, skip link, visible focus, reflow and target size.
// The manual record, including what was not tested, is docs/ACCESSIBILITY-REVIEW-1D.md.
test.beforeEach(resetExtras);
test.afterAll(resetExtras);

const opts = [{ id: 'a', text: 'Alpha option' }, { id: 'b', text: 'Bravo option' }, { id: 'c', text: 'Charlie option' }, { id: 'd', text: 'Delta option' }];
const base = { prompt: 'A prompt that is long enough to be valid.', difficulty: 'easy' };
const mechanics = [
  { slug: 'sg-mc', mechanic: 'multiple_choice', extra: { options: opts }, value: 'b' },
  { slug: 'sg-tf', mechanic: 'true_false', extra: {}, value: true },
  { slug: 'sg-text', mechanic: 'short_text', extra: {}, value: { accepted: ['quokka'] } },
  { slug: 'sg-num', mechanic: 'number', extra: {}, value: { value: 42, tolerance: 0 } },
  { slug: 'sg-odd', mechanic: 'odd_one_out', extra: { items: opts }, value: 'c' },
  { slug: 'sg-order', mechanic: 'put_in_order', extra: { items: opts.slice(0, 3) }, value: ['c', 'a', 'b'] },
  { slug: 'sg-clue', mechanic: 'clue_reveal', extra: { clues: ['Clue one here', 'Clue two here'] }, value: { accepted: ['okapi'] } },
];

async function addFixtures() {
  for (const f of mechanics) {
    await addItem({
      world: 'play', slug: f.slug, kind: 'quiz', title: `Signoff ${f.slug}`, body: { mechanic: f.mechanic, ...base, ...f.extra },
      answer: { value: f.value, explanation: `Explanation for ${f.slug}, long enough to be valid.` },
    });
  }
  await addTopic('e2e-signoff', 'E2E signoff');
  await addItem({ world: 'discover', slug: 'sg-topic', title: 'Signoff topic item', topics: ['e2e-signoff'] });
}

const TRUST = ['/about/', '/editorial-policy/', '/privacy/', '/terms/', '/accessibility/', '/contact/'];
const PAGES = [
  '/', '/play/', '/discover/', '/together/', '/grow/', '/kids/', '/kids/shadow-explorers/', '/discover/a-day-in-shadows/',
  '/play/number-detective-001/', '/quiz/', '/quiz/archive/', '/search/', '/search/?q=shadows', '/search/?q=zzzzqqqq',
  '/topics/e2e-signoff/', '/report/discover/a-day-in-shadows/', '/report/discover/a-day-in-shadows/?error=1#result', ...TRUST,
  '/play/sg-mc/', '/play/sg-order/', '/play/sg-clue/', '/no-such-world/no-such-item/',
];

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  return r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

test('axe finds no violation of any impact on every public page and state', async ({ page }) => {
  await addFixtures();
  const found: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    for (const v of await axe(page)) found.push(`${path} -> ${v}`);
  }
  expect(found).toEqual([]);
});

test('axe finds no violation after answering, with a wrong answer, and after a sent report', async ({ page }) => {
  await addFixtures();
  const found: string[] = [];
  const check = async (label: string) => (await axe(page)).forEach((v) => found.push(`${label} -> ${v}`));
  for (const q of ['r=a', 'r=b']) {
    await page.goto(`/play/sg-mc/?${q}`);
    await check(`sg-mc ${q}`);
  }
  await page.goto('/play/sg-order/?pos-a=1&pos-b=1&pos-c=2');
  await check('order invalid');
  await page.goto('/play/sg-order/?pos-c=1&pos-a=2&pos-b=3');
  await check('order right');
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': '10.2.0.1' });
  await page.goto('/report/discover/a-day-in-shadows/');
  await page.getByRole('radio', { name: /broken/ }).check();
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.locator('#result')).toBeVisible();
  await check('report sent');
  expect(found).toEqual([]);
});

test('the skip link is the first stop and moves keyboard focus into the main content', async ({ page }) => {
  for (const path of ['/', '/about/', '/search/']) {
    await page.goto(path);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip, path).toBeFocused();
    await expect(skip, path).toBeInViewport();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('main')), `${path}: focus in main`).toBe(true);
  }
});

test('every mechanic can be answered with the keyboard alone and focus lands on the verdict', async ({ page }) => {
  await addFixtures();
  await page.goto('/play/sg-mc/');
  await page.getByRole('radio', { name: /Bravo/ }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab'); // leaves the radio group, onto the submit button
  await expect(page.getByRole('button', { name: /Check answer/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#result')).toBeFocused();
  await expect(page.locator('#result')).toContainText('Correct');

  await page.goto('/play/sg-tf/');
  await page.getByRole('radio', { name: 'True' }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter'); // Enter inside a radio submits the form
  await expect(page.locator('#result')).toBeFocused();

  await page.goto('/play/sg-num/');
  await page.getByLabel('Your answer').focus();
  await page.keyboard.type('42');
  await page.keyboard.press('Enter');
  await expect(page.locator('#result')).toContainText('Correct');

  await page.goto('/play/sg-text/');
  await page.getByLabel('Your answer').focus();
  await page.keyboard.type('quokka');
  await page.keyboard.press('Enter');
  await expect(page.locator('#result')).toContainText('Correct');

  await page.goto('/play/sg-odd/');
  await page.getByRole('radio', { name: /Charlie/ }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await expect(page.locator('#result')).toContainText('Correct');

  await page.goto('/play/sg-order/');
  for (const [label, pos] of [['Alpha', '2'], ['Bravo', '3'], ['Charlie', '1']]) {
    await page.getByRole('combobox', { name: `Position of ${label} option` }).focus();
    await page.keyboard.type(pos);
  }
  await page.keyboard.press('Tab'); // Enter inside a select does not submit; the button is the next stop
  await expect(page.getByRole('button', { name: /Check answer/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#result')).toContainText('Correct');

  await page.goto('/play/sg-clue/');
  await page.getByRole('link', { name: 'Show another clue' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Clue two here')).toBeVisible();
  await page.getByLabel('Your answer').focus();
  await page.keyboard.type('okapi');
  await page.keyboard.press('Enter');
  await expect(page.locator('#result')).toContainText('Correct');
});

test('every control reached by Tab on key pages shows a visible focus indicator', async ({ page }) => {
  await addFixtures();
  const bad: string[] = [];
  for (const path of ['/', '/search/', '/play/sg-mc/', '/play/sg-order/', '/report/discover/a-day-in-shadows/', '/about/', '/discover/a-day-in-shadows/']) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(path);
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2) || s.boxShadow !== 'none';
        return { tag: el.tagName.toLowerCase(), text: (el.textContent ?? el.getAttribute('name') ?? '').trim().slice(0, 30), visible };
      });
      if (!info) break;
      if (!info.visible) bad.push(`${path}: ${info.tag} "${info.text}"`);
    }
  }
  expect(bad).toEqual([]);
});

test('no page scrolls sideways at 320px and links in navigation are at least 24px tall', async ({ page }) => {
  await addFixtures();
  await page.setViewportSize({ width: 320, height: 800 });
  const wide: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) wide.push(path);
  }
  expect(wide).toEqual([]);

  await page.goto('/discover/a-day-in-shadows/');
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.breadcrumbs a, .pager a, footer nav a'))
      .map((a) => ({ t: a.textContent, h: a.getBoundingClientRect().height }))
      .filter((x) => x.h < 24),
  );
  expect(small).toEqual([]);
});

test('text can be enlarged to 200% without loss: no horizontal scroll and content still present', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 800 }); // 1280px at 200% zoom
  for (const path of ['/', '/discover/a-day-in-shadows/', '/privacy/', '/play/number-detective-001/']) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
});
