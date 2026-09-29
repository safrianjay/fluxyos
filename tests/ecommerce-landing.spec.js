const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
test.beforeEach(async ({page})=>{
  await page.route(/fonts\.googleapis\.com/,r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.route(/www\.googletagmanager\.com/,r=>r.fulfill({body:'',contentType:'application/javascript'}));
});
for(const locale of ['en','id']){
  const url=(locale==='id'?'/id':'')+'/use-cases/ecommerce-brands';
  for(const width of [320,390,768,1024,1440]) test(`${locale} responsive ${width}`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize({width,height:900});
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await expect(page.locator('main h1')).toHaveCount(1);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('.ec-workspace')).toBeVisible();
    await expect(page.locator('.ec-hero-record')).toBeVisible();
    if(width>=1024){
      const heading=await page.locator('main h1').boundingBox();
      const visual=await page.locator('.ec-hero-visual').boundingBox();
      expect(Math.abs(heading.y-visual.y)).toBeLessThan(60);
    }
    await expect(page.locator('.ec-hero .ec-button-primary')).toHaveAttribute('href',locale==='id'?'/id/pricing':'/pricing');
    await expect(page.locator('.ec-hero .ec-button-secondary')).toHaveAttribute('href','/contact-sales');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    if(width<1024){
      await page.locator('.mobile-menu-toggle').click();
      await expect(page.locator('#mobile-menu')).toBeVisible();
      await page.locator('.mobile-menu-toggle').click();
    }
    for(const selector of ['.ec-stock-composition','.ec-payment-visual','.ec-reports','.ec-performance','.ec-ai-window','.ec-ecosystem','.ec-faq','.footer-component']){
      await page.locator(selector).scrollIntoViewIfNeeded();
      await expect(page.locator(selector)).toBeVisible();
      const rect=await page.locator(selector).boundingBox();
      expect(rect.width).toBeGreaterThan(200);
      expect(rect.x).toBeGreaterThanOrEqual(-1);
      expect(rect.x+rect.width).toBeLessThanOrEqual(width+1);
    }
    const schemas=await page.locator('script[type="application/ld+json"]').evaluateAll(xs=>xs.map(x=>JSON.parse(x.textContent)));
    expect(schemas.map(x=>x['@type'])).toEqual(expect.arrayContaining(['Organization','SoftwareApplication','BreadcrumbList','FAQPage']));
    const faqs=schemas.find(x=>x['@type']==='FAQPage').mainEntity;
    const visible=page.locator('.ec-faq details');await expect(visible).toHaveCount(faqs.length);
    for(let i=0;i<faqs.length;i++){
      await expect(visible.nth(i).locator('summary')).toContainText(faqs[i].name);
      await expect(visible.nth(i).locator('p')).toHaveText(faqs[i].acceptedAnswer.text);
    }
    await visible.first().locator('summary').click();await expect(visible.first().locator('p')).toBeVisible();
    expect((await page.title()).length).toBeLessThanOrEqual(60);
    expect((await page.locator('meta[name="description"]').getAttribute('content')).length).toBeLessThanOrEqual(160);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://fluxyos.com'+url);
    await expect(page.locator('link[hreflang="en"]')).toHaveAttribute('href','https://fluxyos.com/use-cases/ecommerce-brands');
    await expect(page.locator('link[hreflang="id"]')).toHaveAttribute('href','https://fluxyos.com/id/use-cases/ecommerce-brands');
    expect(await page.locator('main').innerText()).not.toMatch(/Shopify|WooCommerce|Tokopedia|Lazada|Blibli|guaranteed|250\+|24\/7/);
    expect(errors).toEqual([]);
  });
  test(`${locale} financial tabs, workflow and AI controls`,async({page})=>{
    await page.goto(url,{waitUntil:'domcontentloaded'});
    const tabs=page.locator('[data-report-tab]');
    await tabs.first().focus();await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();await expect(tabs.nth(1)).toHaveAttribute('aria-selected','true');
    await expect(page.locator('#ec-report-1')).toBeVisible();await expect(page.locator('#ec-report-0')).toBeHidden();
    await page.keyboard.press('End');await expect(tabs.last()).toBeFocused();
    await expect(page.locator('#ec-report-2')).toContainText('Rp97.000.000');
    await page.keyboard.press('Home');await expect(tabs.first()).toBeFocused();
    await page.locator('[data-flow-step="0"]').focus();await page.keyboard.press('End');
    await expect(page.locator('[data-flow-step="3"]')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#ec-flow-panel-3')).toBeVisible();
    await expect(page.locator('[data-flow-node="3"]')).toHaveClass('is-current');
    await expect(page.locator('#ec-flow-panel-3')).toContainText('Rp90.000 = Rp90.000');
    await page.locator('[data-flow-replay]').click();
    await expect(page.locator('[data-flow-step="0"]')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('[data-flow-step="1"]')).toHaveAttribute('aria-pressed','true',{timeout:4500});
    await page.locator('[data-ai-question="1"]').click();
    await expect(page.locator('[data-ai-answer="1"]')).toBeVisible();
    await expect(page.locator('[data-ai-answer="1"] [data-answer-text]')).toContainText('Rp1.500.000');
    await expect(page.locator('[data-ai-answer="1"] [data-answer-text]')).toContainText('Rp500.000');
    await page.locator('[data-ai-question="2"]').click();
    await expect(page.locator('[data-ai-answer="2"] [data-answer-text]')).toContainText('Rp29.000.000');
    await page.locator('[data-ai-question="0"]').click();
    await expect(page.locator('[data-ai-answer="0"] [data-answer-text]')).toContainText('Rp184.000.000');
    for(const href of await page.locator('.ec-ecosystem a').evaluateAll(xs=>xs.map(x=>x.getAttribute('href')))){
      const response=await page.request.get(href);expect(response.ok(),href).toBe(true);
    }
  });
  test(`${locale} no-JS content and footer`,async({browser})=>{
    const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();
    await page.route(/fonts\.googleapis\.com/,r=>r.fulfill({body:'',contentType:'text/css'}));
    await page.goto('http://127.0.0.1:8765'+url,{waitUntil:'domcontentloaded'});
    for(const selector of ['[data-flow-panel]','[data-report-panel]','[data-ai-answer]']){
      const items=page.locator(selector);for(let i=0;i<await items.count();i++){await items.nth(i).scrollIntoViewIfNeeded();await expect(items.nth(i)).toBeVisible();}
    }
    await expect(page.locator('.footer-component')).toBeAttached();
    await page.locator('.footer-component').scrollIntoViewIfNeeded();await expect(page.locator('.footer-component')).toBeVisible();
    await context.close();
  });
}
for(const width of [390,768,1440])test(`Hero auto-motion without hover ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});await page.goto('/use-cases/ecommerce-brands',{waitUntil:'domcontentloaded'});
  await page.locator('.ec-hero-record').scrollIntoViewIfNeeded();
  const hero=page.locator('.ec-hero-visual');const before=await hero.getAttribute('data-stage');
  await expect.poll(()=>hero.getAttribute('data-stage'),{timeout:4500}).not.toBe(before);
  const after=await hero.getAttribute('data-stage');await expect(page.locator(`[data-hero-stage="${after}"]`)).toBeVisible();
});
test('Reduced motion stays static while controls still work',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/use-cases/ecommerce-brands',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.ec-hero-visual')).toHaveAttribute('data-stage','0');await page.waitForTimeout(3300);
  await expect(page.locator('.ec-hero-visual')).toHaveAttribute('data-stage','0');
  await page.locator('[data-ai-question="1"]').click();await expect(page.locator('[data-ai-answer="1"] [data-answer-text]')).toContainText('Rp500.000');
  await page.locator('[data-report-tab="2"]').click();await expect(page.locator('#ec-report-2')).toBeVisible();
  const running=await page.locator('main').evaluate(n=>n.getAnimations({subtree:true}).filter(a=>a.playState==='running').length);
  expect(running).toBe(0);
});
test('EN/ID generation stays paired and OG has correct dimensions',async()=>{
  require('child_process').execFileSync('node',['scripts/build-ecommerce-page.js','--check'],{cwd:path.resolve(__dirname,'..')});
  const png=fs.readFileSync(path.resolve(__dirname,'../assets/images/og-ecommerce-brands.png'));
  expect(png.readUInt32BE(16)).toBe(1200);expect(png.readUInt32BE(20)).toBe(630);
});
