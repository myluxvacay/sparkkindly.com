// Throwaway staging verification for the age-band build (not part of the repo suite).
import { chromium } from '@playwright/test';

const BASE = 'https://staging.sparkkindly.com';
const out = [];
const log = (name, ok, detail = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const proxyUrl = new URL(process.env.https_proxy);
const browser = await chromium.launch({
  proxy: {
    server: `${proxyUrl.protocol}//${proxyUrl.host}`,
    username: decodeURIComponent(proxyUrl.username),
    password: decodeURIComponent(proxyUrl.password),
  },
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

// 1. First visit: picker appears; choose Ages 6-8.
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
const picker = page.locator('.band-picker');
await picker.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
log('picker appears on first visit', await picker.isVisible().catch(() => false));
await page.getByRole('button', { name: /Ages 6–8/ }).click();
await page.waitForTimeout(600);
const stored = await page.evaluate(() => localStorage.getItem('sk-age-band'));
log('band stored after pick', stored === '6-8', `sk-age-band=${stored}`);
log('picker closes after pick', !(await picker.isVisible().catch(() => false)));

// 2. Reload: picker stays away; footer shows the band; Change reopens.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
log('picker absent after reload', !(await picker.isVisible().catch(() => false)));
const footerText = await page.locator('footer').innerText().catch(() => '');
log('footer shows Exploring as Ages 6-8', /Exploring as:\s*Ages 6–8/.test(footerText), footerText.split('\n').find((l) => l.includes('Exploring')) ?? '');
await page.locator('footer').getByRole('button', { name: /Change/ }).click();
await picker.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
log('footer Change reopens picker', await picker.isVisible().catch(() => false));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// 3. World listing: band-lead bar present with band 6-8.
await page.goto(BASE + '/kids/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
const barText = await page.locator('.band-lead-bar').first().innerText().catch(() => '');
log('kids listing leads with band', /Ages 6–8 first/.test(barText), barText.trim());

// 4. Today's Spark: capture the served question, answer it, reload, expect a different one.
await page.goto(BASE + '/quiz/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000); // island band-swap settles
const panel = page.locator('.quiz-panel').first();
const q1 = await panel.getAttribute('data-daily-current');
const q1text = (await panel.locator('h2, h3, p').first().innerText().catch(() => '')).trim().slice(0, 60);
log('daily model embedded', !!q1, `current=${q1} "${q1text}"`);
// Answer: pick the first option, submit.
await panel.locator('label').first().click();
await panel.getByRole('button', { name: /Check answer/ }).click();
await page.waitForTimeout(2500);
const resultSeen = await page.locator('.quiz-result').count();
log('answer produces a result panel', resultSeen > 0);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const panel2 = page.locator('.quiz-panel').first();
const q2 = await panel2.getAttribute('data-daily-current');
const q2text = (await panel2.locator('h2, h3, p').first().innerText().catch(() => '')).trim().slice(0, 60);
log('reload after answering serves a DIFFERENT question', !!q2 && q2 !== q1, `before=${q1} after=${q2} "${q2text}"`);

// 5. Printables hub: canonical age filter narrows the shelf.
await page.goto(BASE + '/printables/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
const cards = page.locator('[data-bands]');
const total = await cards.count();
await page.getByRole('button', { name: /Ages 3–5/ }).first().click().catch(async () => {
  await page.locator('text=Ages 3–5').first().click();
});
await page.waitForTimeout(800);
let visible = 0;
for (let i = 0; i < total; i++) { if (await cards.nth(i).isVisible().catch(() => false)) visible++; }
log('printables filter narrows shelf', total > 0 && visible > 0 && visible < total, `total=${total} visible@3-5=${visible}`);

// 6. Item page chip.
await page.goto(BASE + '/kids/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
const firstCard = page.locator('a[href^="/kids/"]').first();
const href = await firstCard.getAttribute('href');
if (href) {
  await page.goto(BASE + href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const body = await page.locator('main').innerText().catch(() => '');
  log('item page shows a band chip', /Ages \d/.test(body), href);
} else log('item page shows a band chip', false, 'no kids card link found');

await browser.close();
console.log(out.join('\n'));
