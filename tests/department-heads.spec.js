const {test,expect}=require('./public-test');
for(const locale of ['en','id'])for(const width of [1440,1024,768,390,320])test(`${locale} department review ${width}`,async({page,request})=>{
 const prefix=locale==='id'?'/id':'',errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:900});await page.goto(prefix+'/use-cases/department-heads',{waitUntil:'domcontentloaded'});
 await expect(page.locator('h1')).toHaveCount(1);await expect(page.locator('html')).toHaveAttribute('lang',locale);
 await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://fluxyos.com'+prefix+'/use-cases/department-heads');
 expect((await page.title()).length).toBeLessThanOrEqual(60);expect((await page.locator('meta[name=description]').getAttribute('content')).length).toBeLessThanOrEqual(160);
 const tabs=page.locator('[data-department-tour] [role=tab]'),panels=page.locator('[data-department-tour] [role=tabpanel]');await tabs.first().scrollIntoViewIfNeeded();await page.evaluate(()=>document.fonts.ready);const tourHeight=await page.locator('.hd-walkthrough').evaluate(e=>e.getBoundingClientRect().height);
 for(let i=0;i<3;i++){await tabs.nth(i).click();await expect(tabs.nth(i)).toHaveAttribute('aria-selected','true');await expect(panels.nth(i)).toBeVisible();await expect(panels.filter({visible:true})).toHaveCount(1);expect(Math.abs(await page.locator('.hd-walkthrough').evaluate(e=>e.getBoundingClientRect().height)-tourHeight)).toBeLessThan(2);}
 await tabs.last().focus();await page.keyboard.press('ArrowRight');await expect(tabs.first()).toBeFocused();await page.keyboard.press('End');await expect(tabs.last()).toBeFocused();await page.keyboard.press('Home');await expect(tabs.first()).toBeFocused();
 const schemas=(await page.locator('script[type="application/ld+json"]').allTextContents()).map(JSON.parse);expect(schemas.map(s=>s['@type'])).toEqual(expect.arrayContaining(['Organization','SoftwareApplication','BreadcrumbList','FAQPage']));
 for(const q of schemas.find(s=>s['@type']==='FAQPage').mainEntity){expect(await page.locator('#faq').textContent()).toContain(q.name);expect(await page.locator('#faq').textContent()).toContain(q.acceptedAnswer.text);}
 await page.locator('#faq summary').first().focus();await page.keyboard.press('Enter');await expect(page.locator('#faq details').first()).toHaveAttribute('open','');
 for(const img of await page.locator('main img:visible').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode());expect(await img.evaluate(e=>e.naturalWidth)).toBeGreaterThan(0);await expect(img).toHaveAttribute('alt','');}
 for(const href of new Set(await page.locator('main a').evaluateAll(es=>es.map(e=>e.getAttribute('href')).filter(h=>h?.startsWith('/')))))expect((await request.get(href)).status(),href).toBe(200);
 await expect(page.locator('nav [data-nav-entry=department-heads]').first()).toHaveAttribute('href',prefix+'/use-cases/department-heads');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
 if([1440,390].includes(width)){await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(600);await page.screenshot({path:`.qa/department/${locale}-${width}-hero.png`});await page.screenshot({path:`.qa/department/${locale}-${width}-full.png`,fullPage:true});}
});
test('reduced motion and translated navigation',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/id/use-cases/department-heads');await expect(page.locator('[data-hero-motion]')).toHaveAttribute('data-motion-running','false');expect(await page.locator('[data-hero-motion]').evaluate(e=>getComputedStyle(e,'::before').animationName)).toBe('none');await expect(page.locator('[data-hero-pause], [data-cf-replay]')).toHaveCount(0);
 await expect(page.locator('a').filter({hasText:'English (EN)'}).first()).toHaveAttribute('href','/use-cases/department-heads');
});
