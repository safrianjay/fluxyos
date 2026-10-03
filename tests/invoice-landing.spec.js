const { test, expect } = require('./public-test');
for (const locale of ['en', 'id']) {
  const route = locale === 'id' ? '/id/vendorspend' : '/vendorspend';
  for (const width of [360, 768, 1024, 1440]) {
    test(`Invoice ${locale} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({width,height:900});
      const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      await page.goto(route,{waitUntil:'domcontentloaded'});
      await expect(page.locator('html')).toHaveAttribute('lang',locale);
      await expect(page.locator('h1')).toBeInViewport();
      await expect(page.locator('.invoice-hero-stage')).toBeVisible();
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
      const scan=page.locator('.invoice-scan-beam');
      await expect(scan).toHaveCSS('animation-name','invoice-scan');
      const before=await scan.evaluate(el=>getComputedStyle(el).top);
      await page.waitForTimeout(1800);
      const after=await scan.evaluate(el=>getComputedStyle(el).top);
      expect(after).not.toBe(before);
      const steps=page.locator('[data-invoice-step]');
      await steps.nth(1).click();
      await expect(page.locator('[data-process-stage]')).toHaveAttribute('data-process-stage','1');
      await steps.nth(2).focus(); await page.keyboard.press('Enter');
      await expect(steps.nth(2)).toHaveAttribute('aria-pressed','true');
      await steps.nth(3).click();
      await expect(page.locator('[data-stage-caption]')).toHaveText(locale==='id'?'Tagihan sudah diperiksa dan disimpan':'Reviewed bill saved · ready to track');
      await page.locator('[data-invoice-filter="paid"]').click();
      await expect(page.locator('[data-invoice-row]:visible')).toHaveCount(1);
      await page.locator('[data-invoice-filter="open"]').focus(); await page.keyboard.press('Enter');
      await expect(page.locator('[data-invoice-row]:visible')).toHaveCount(3);
      await page.locator('[data-invoice-filter="all"]').click();
      await expect(page.locator('[data-invoice-row]:visible')).toHaveCount(4);
      const schemas=await page.locator('script[type="application/ld+json"]').evaluateAll(es=>es.map(e=>JSON.parse(e.textContent)));
      for(const type of ['Organization','SoftwareApplication','BreadcrumbList','FAQPage'])expect(schemas.some(s=>s['@type']===type)).toBeTruthy();
      const faqs=schemas.find(s=>s['@type']==='FAQPage').mainEntity;
      await expect(page.locator('.invoice-faq details')).toHaveCount(faqs.length);
      for(let i=0;i<faqs.length;i++){
        const item=page.locator('.invoice-faq details').nth(i);
        await expect(item.locator('summary')).toHaveText(faqs[i].name);
        await expect(item.locator('p')).toHaveText(faqs[i].acceptedAnswer.text);
      }
      await page.locator('.invoice-books-workspace').scrollIntoViewIfNeeded();
      await expect(page.locator('.invoice-books-source-total')).toContainText('Rp4.800.000');
      await expect(page.locator('.invoice-books-table tfoot td')).toHaveText(['Rp4.800.000','Rp4.800.000']);
      await expect(page.locator('.invoice-books-destinations strong')).toHaveText(['Rp4.800.000','Rp4.800.000']);
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
      const footer=page.locator('.footer-component'); await footer.scrollIntoViewIfNeeded();
      await expect(footer).toBeVisible();
      await expect(footer.locator('a').filter({hasText:/^Invoice$/})).toHaveAttribute('href',route);
      await expect(page.locator('.invoice-hero .invoice-primary')).toHaveAttribute('href',locale==='id'?'/id/pricing':'/pricing');
      await expect(page.locator('.invoice-hero .invoice-button').nth(1)).toHaveAttribute('href','/contact-sales');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://fluxyos.com'+route);
      if(width<1024){await page.locator('.mobile-menu-toggle').click();await expect(page.locator('#mobile-menu')).toBeVisible();await page.locator('.mobile-menu-toggle').click();}
      expect(errors).toEqual([]);
    });
  }
  for (const width of [390,1440]) {
    test(`Invoice ${locale} auto steps at ${width}px`,async({page})=>{
      await page.clock.install();
      await page.setViewportSize({width,height:900});
      await page.goto(route);
      const grid=page.locator('.invoice-processing-grid');
      const visual=page.locator('[data-process-stage]');
      const steps=page.locator('[data-invoice-step]');
      await grid.scrollIntoViewIfNeeded();
      await expect(grid).toHaveAttribute('data-autoplay','running');
      await expect(steps.first()).toHaveCSS('position','relative');
      for(const stage of ['1','2','3','0']) {
        await page.clock.runFor(4500);
        await expect(visual).toHaveAttribute('data-process-stage',stage);
        await expect(steps.nth(Number(stage))).toHaveAttribute('aria-pressed','true');
      }
      await steps.nth(2).click();
      await expect(grid).toHaveAttribute('data-autoplay','paused');
      await page.clock.runFor(9000);
      await expect(visual).toHaveAttribute('data-process-stage','2');
      await steps.nth(2).evaluate(el=>el.blur());
      await page.clock.runFor(1);
      await expect(grid).toHaveAttribute('data-autoplay','running');
      await page.clock.runFor(4500);
      await expect(visual).toHaveAttribute('data-process-stage','3');
      await page.emulateMedia({reducedMotion:'reduce'});
      await expect(grid).toHaveAttribute('data-autoplay','paused');
      await page.clock.runFor(9000);
      await expect(visual).toHaveAttribute('data-process-stage','3');
    });
  }
  test(`Invoice ${locale} without JavaScript`,async({browser})=>{
    const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    const page=await context.newPage();await page.goto('http://127.0.0.1:8765'+route);
    await expect(page.locator('h1')).toBeVisible();await expect(page.locator('.invoice-field')).toHaveCount(6);
    await expect(page.locator('[data-invoice-row]')).toHaveCount(4);
    const faq=page.locator('.invoice-faq details').first();await faq.locator('summary').click();await expect(faq.locator('p')).toBeVisible();
    await expect(page.locator('.footer-component')).toBeVisible();await context.close();
  });
  test(`Invoice ${locale} reduced motion`,async({page})=>{
    await page.emulateMedia({reducedMotion:'reduce'});await page.goto(route);
    await expect(page.locator('.invoice-scan-beam')).toHaveCSS('animation-name','none');
    await expect(page.locator('.invoice-hero-result')).toHaveCSS('animation-name','none');
    await expect(page.locator('.invoice-hero-result')).toBeVisible();
  });
}
