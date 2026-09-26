const {test,expect} = require('@playwright/test');
for (const locale of ['en','id']) {
  const route = locale === 'id' ? '/id/aiagents' : '/aiagents';
  for (const width of [390,768,1024,1440]) {
    test('Fluxy AI '+locale+' '+width,async ({page}) => {
      await page.setViewportSize({width,height:900});
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(route,{waitUntil:'domcontentloaded'});
      await expect(page.locator('html')).toHaveAttribute('lang',locale);
      await expect(page.locator('h1')).toBeInViewport();
      await expect(page.locator('.agent-hero-particles')).toBeVisible();
      await expect(page.locator('.agent-hero-particles')).toHaveCSS('position','absolute');
      await expect(page.locator('.footer-component')).toBeAttached();
      await page.locator('.footer-component').scrollIntoViewIfNeeded();
      await expect(page.locator('.footer-component')).toBeInViewport();
      await expect(page.locator('.footer-component > div').first()).toHaveCSS('opacity','1');
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
      await expect(page.locator('.agent-receipt-total')).toContainText('Rp2.400.000');
      await expect(page.locator('.agent-extracted-fields dd')).toHaveCount(4);
      await expect(page.locator('.agent-context-chip')).toHaveCount(7);
      await expect(page.locator('.agent-linked-records')).toContainText('receipt-024.pdf');
      const headingGap=await page.locator('.agent-questions-section').evaluate(section=>section.querySelector('.agent-workflow').getBoundingClientRect().top-section.querySelector('.agent-section-heading').getBoundingClientRect().bottom);
      expect(headingGap).toBeLessThanOrEqual(32);
      const prompts=page.locator('[data-agent-question]');
      await expect(prompts).toHaveCount(3);
      await prompts.nth(1).click();
      await expect(prompts.nth(1)).toHaveAttribute('aria-pressed','true');
      await expect(page.locator('[data-agent-demo] [data-demo-value]')).toHaveText('Rp48.000.000');
      await prompts.nth(2).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-agent-demo] [data-demo-value]')).toHaveText('Rp32.800.000');
      const insights=page.locator('[data-agent-insight]');
      await page.locator('#financial-questions').scrollIntoViewIfNeeded();
      await expect(page.locator('.agent-insight-controls')).toBeVisible();
      await expect(page.locator('.agent-insight-visual .agent-window')).toBeVisible();
      await expect(page.locator('.agent-insight-visual')).toContainText('Rp48.000.000');
      await insights.nth(1).locator('summary').click();
      await expect(page.locator('.agent-insight-visual')).toContainText('receipt-024.pdf');
      await insights.nth(2).locator('summary').click();
      await expect(insights.nth(2)).toHaveAttribute('open','');
      await expect(page.locator('.agent-insight-visual')).toContainText('receipt-024.pdf');
      const schemas=await page.locator('script[type="application/ld+json"]').evaluateAll(xs=>xs.map(x=>JSON.parse(x.textContent)));
      const faq=schemas.find(x=>x['@type']==='FAQPage').mainEntity;
      const visible=page.locator('.agent-faq details');
      await expect(visible).toHaveCount(faq.length);
      for(let i=0;i<faq.length;i++){
        await expect(visible.nth(i).locator('summary')).toContainText(faq[i].name);
        await expect(visible.nth(i).locator('p')).toHaveText(faq[i].acceptedAnswer.text);
      }
      await visible.first().locator('summary').click();
      await expect(visible.first().locator('p')).toBeVisible();
      const pricing=locale==='id'?'/id/pricing':'/pricing';
      await expect(page.locator('.agent-hero .agent-button-primary')).toHaveAttribute('href',pricing);
      await expect(page.locator('.agent-hero .agent-button').nth(1)).toHaveAttribute('href','/contact-sales');
      if(width<1024){
        await page.locator('.mobile-menu-toggle').click();
        await expect(page.locator('#mobile-menu')).toBeVisible();
        await page.locator('.mobile-menu-toggle').click();
      }
      expect(errors).toEqual([]);
      expect(await page.locator('main').innerText()).not.toMatch(/24\/7|six specialized|bank-level encryption|guaranteed/i);
    });
  }
  test('Fluxy AI '+locale+' no JavaScript',async ({browser})=>{
    const context=await browser.newContext({javaScriptEnabled:false});
    const page=await context.newPage();
    await page.goto(route,{waitUntil:'domcontentloaded'});
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.agent-window')).toHaveCount(9);
    await expect(page.locator('.agent-faq details')).toHaveCount(6);
    await expect(page.locator('.footer-component')).toBeAttached();
    await page.locator('.footer-component').scrollIntoViewIfNeeded();
    await expect(page.locator('.footer-component')).toBeInViewport();
    await page.locator('.agent-faq summary').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.agent-faq details').first().locator('p')).toBeVisible();
    await context.close();
  });
}
test('hero motion continues without hovering after the intro',async ({page})=>{
  await page.goto('/aiagents',{waitUntil:'domcontentloaded'});
  const canvas=page.locator('.agent-hero-particles');
  await expect(canvas).toHaveAttribute('data-ready','');
  await page.waitForTimeout(5100);
  const before=await canvas.evaluate(node=>node.toDataURL());
  await page.waitForTimeout(250);
  expect(await canvas.evaluate((node,previous)=>node.toDataURL()!==previous,before)).toBe(true);
});
test('reduced motion keeps the backdrop static',async ({browser})=>{
  const context=await browser.newContext({reducedMotion:'reduce'});
  await context.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, route=>route.abort());
  const page=await context.newPage();
  await page.goto('/aiagents',{waitUntil:'domcontentloaded'});
  const canvas=page.locator('[data-hero-particles]');
  await expect(canvas).toHaveAttribute('data-ready','');
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(100);
  const before=await canvas.evaluate(x=>x.toDataURL());
  await page.waitForTimeout(150);
  expect(await canvas.evaluate((x,previous)=>x.toDataURL()===previous,before)).toBe(true);
  await expect(page.locator('.agent-hero-demo .agent-window').first()).toHaveCSS('animation-name','none');
  await context.close();
});
