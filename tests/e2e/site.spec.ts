import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
const release=process.env.SITE_RELEASE!=='false';
test.beforeEach(async({page})=>{await page.clock.install({time:new Date('2026-10-17T12:00:00Z')});});
test('home to brand to article, direct refresh and useful 404',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toHaveText('Brighter minds.Kinder tomorrows.');
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Discover',exact:true}).click();
 await page.getByRole('link',{name:'A day in shadows'}).first().click();await expect(page.getByRole('heading',{level:1})).toHaveText('A day in shadows');
 await page.reload();await expect(page.getByRole('heading',{name:'Follow a changing angle'})).toBeVisible();expect(errors).toEqual([]);
 await page.goto('/404.html');await expect(page.getByRole('heading',{name:'This spark wandered off.'})).toBeVisible();
});
test('quiz submit, explanation and archive work on the server',async({page})=>{
 await page.goto('/play/number-detective-001/');await expect(page.getByText(/The terms are 1×2/)).toHaveCount(0);await page.getByRole('radio',{name:/30/}).check();await page.getByRole('button',{name:/Check answer/}).click();
 await expect(page.getByRole('status')).toContainText('Answer: 30');await expect(page.getByText(/The terms are 1×2/)).toBeVisible();
 await page.getByRole('link',{name:/Try this one again/}).click();await expect(page.getByRole('button',{name:/Check answer/})).toBeVisible();
 await page.goto('/quiz/archive/');await expect(page.getByRole('heading',{level:1})).toHaveText('The quiz archive');
});
test('mobile disclosure keyboard, Escape, focus and 320px reflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');const menu=page.getByRole('button',{name:'Menu ☰'});await menu.focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Close ✕'})).toHaveAttribute('aria-expanded','true');await page.keyboard.press('Tab');await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Play',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toBeFocused();await expect(menu).toHaveAttribute('aria-expanded','false');
 for(const route of ['/','/kids/','/kids/shadow-explorers/','/quiz/']){await page.setViewportSize({width:320,height:800});await page.goto(route);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}
});
test('axe homepage, Kids, article and submitted quiz have no serious/critical violations',async({page})=>{
 for(const path of ['/','/kids/','/discover/a-day-in-shadows/','/quiz/']){await page.goto(path);if(path==='/quiz/'){await page.getByRole('radio').first().check();await page.getByRole('button',{name:/Check answer/}).click();await expect(page.getByRole('status')).toBeVisible();}const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical'),JSON.stringify(result.violations)).toEqual([]);}
});
test('Kids navigation sends no third party requests, stores no identifiers',async({page,context})=>{
 const thirdParty:string[]=[];page.on('request',r=>{if(!r.url().startsWith('http://localhost:4173/'))thirdParty.push(r.url());});
 for(const path of ['/kids/','/kids/words-that-help/','/quiz/','/kids/shadow-explorers/']){await page.goto(path);expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});}
 expect(await context.cookies()).toEqual([]);expect(thirdParty).toEqual([]);
});
test('without JavaScript, articles and dated answers remain readable',async({browser})=>{
 const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();await page.goto('http://localhost:4173/kids/shadow-explorers/');await expect(page.getByRole('heading',{name:'Trace, wait, compare'})).toBeVisible();await page.goto('http://localhost:4173/play/number-detective-001/');await page.getByRole('radio',{name:/30/}).check();await page.getByRole('button',{name:/Check answer/}).click();await expect(page.getByText(/The terms are 1×2/)).toBeVisible();await context.close();
});
test('metadata, sitemap exclusions, local assets and screenshot evidence',async({page})=>{
 await page.goto('/discover/a-day-in-shadows/');await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://sparkkindly.com/discover/a-day-in-shadows/');await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content',release?'index, follow':'noindex, nofollow');const data=await page.locator('script[type="application/ld+json"]').allTextContents();expect(data.map(d=>JSON.parse(d)['@type'])).toContain('BreadcrumbList');
 const sitemap=await page.request.get('/sitemap.xml');if(release)expect(await sitemap.text()).toContain('a-day-in-shadows');else expect(await sitemap.text()).not.toContain('a-day-in-shadows');const robots=await page.request.get('/robots.txt');expect(await robots.text()).toContain(release?'Allow: /':'Disallow: /');
 await fs.mkdir('docs/screenshots',{recursive:true});for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await page.goto('/');await page.evaluate(async()=>{document.querySelectorAll('img').forEach(i=>i.loading='eager');await document.fonts.ready;await Promise.all(Array.from(document.images).map(i=>i.decode().catch(()=>{})));});await page.screenshot({path:`docs/screenshots/home-${release?"":"preview-"}${width}.png`,fullPage:true});}
});
test('every generated editorial and support destination responds directly',async({request})=>{
 const snapshot=JSON.parse(await fs.readFile('content/mongodb.snapshot.json','utf8'));
 const routes=['/','/play/','/discover/','/together/','/grow/','/kids/','/quiz/','/quiz/archive/','/about/','/editorial-policy/','/privacy/','/terms/','/accessibility/','/contact/',...snapshot.articles.map((a:{brand:string;slug:string})=>`/${a.brand}/${a.slug}/`),...snapshot.quizzes.map((q:{id:string})=>`/quiz/${q.id}/`)];
 for(const route of routes){expect((await request.get(route)).status(),route).toBe(200);}
 const missing=await request.get('/unknown-world/no-such-story/');expect(missing.status()).toBe(404);expect(await missing.text()).toContain('This spark wandered off.');
});
