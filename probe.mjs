import { chromium } from '@playwright/test';
const [a, b, c, band = 'all'] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: { cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'sk-age-band', value: band }] }] },
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)); });
await page.goto('http://localhost:4173/quiz/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const cur1 = await page.locator('[data-daily-current]').first().getAttribute('data-daily-current');
console.log('served current:', cur1, 'expect A:', a);
const model = await page.locator('[data-daily-model]').first().getAttribute('data-daily-model');
try {
  const parsed = JSON.parse(model);
  console.log('chain head:', parsed.chain.slice(0, 4).map((e) => `${e.slug}:${e.id.slice(0, 8)}:${e.bands.join('/')}`).join(' | '));
} catch { console.log('model parse failed, len', model?.length); }
await page.getByRole('radio', { name: /Bravo option/ }).check();
await page.getByRole('button', { name: /Check answer/ }).click();
await page.waitForTimeout(2500);
console.log('after answer URL:', page.url());
console.log('result present:', await page.locator('.quiz-result').count());
const store = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
console.log('localStorage:', store.slice(0, 400));
console.log('after settle current:', await page.locator('[data-daily-current]').first().getAttribute('data-daily-current'));
await page.goto('http://localhost:4173/quiz/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const cur2 = await page.locator('[data-daily-current]').first().getAttribute('data-daily-current');
console.log('on return to /quiz/ current:', cur2, 'expect B:', b);
await browser.close();
