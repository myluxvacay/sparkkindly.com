import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: { cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'sk-age-band', value: 'all' }] }] },
});
const page = await ctx.newPage();
await page.setViewportSize({ width: 640, height: 800 });
for (const path of ['/', '/discover/a-day-in-shadows/', '/privacy/', '/play/number-detective-001/']) {
  await page.goto('http://localhost:4173' + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const report = await page.evaluate(() => {
    const iw = window.innerWidth;
    const bad = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > iw + 1 || r.left < -1)) {
        bad.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').slice(0, 40)} right=${Math.round(r.right)} w=${Math.round(r.width)} text=${(el.textContent || '').trim().slice(0, 40)}`);
      }
    }
    return { sw: document.documentElement.scrollWidth, iw, bad: bad.slice(0, 6) };
  });
  console.log(path, 'scrollWidth=', report.sw, 'innerWidth=', report.iw);
  for (const b of report.bad) console.log('   OVERFLOW:', b);
}
await browser.close();
