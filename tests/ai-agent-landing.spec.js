const {test,expect} = require('@playwright/test');
test.beforeEach(async ({context}) => {
  // Product behavior stays live; UI checks must not depend on analytics/font CDNs.
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({status:200,contentType:'text/css',body:''}));
  await context.route('https://www.googletagmanager.com/**', route => route.fulfill({status:200,contentType:'application/javascript',body:''}));
});
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
      await expect(page.locator('.agent-hero-demo .agent-window')).toHaveCount(1);
      await expect(page.locator('.agent-chat-header')).toContainText('Fluxy AI');
      await expect(page.locator('.agent-chat-header img').first()).toHaveAttribute('src','/assets/images/favicon.svg');
      await expect(page.locator('.agent-chat-ai-icon')).toBeVisible();
      await expect(page.locator('.agent-chat-ai-icon')).toHaveAttribute('src','/assets/images/fluxy-ai-mark.svg');
      await expect(page.locator('.agent-chat-badge')).toHaveCount(0);
      const alignment=await page.locator('.agent-hero').evaluate(hero=>{
        const copy=hero.querySelector('.agent-hero-copy').getBoundingClientRect();
        const card=hero.querySelector('.agent-hero-demo').getBoundingClientRect();
        return {offset:Math.abs(card.left+card.width/2-copy.left-copy.width/2),gap:card.top-copy.bottom,display:getComputedStyle(hero).display};
      });
      expect(alignment.offset).toBeLessThanOrEqual(1);
      expect(alignment.gap).toBeGreaterThanOrEqual(32);
      expect(alignment.display).toBe('block');
      await expect(page.locator('.agent-hero-copy')).toHaveCSS('text-align','center');
      await expect(page.locator('.agent-hero-particles')).toHaveCSS('opacity','1');
      await expect(page.locator('.agent-hero-demo .agent-chat-context, .agent-hero-demo [data-agent-question], .agent-hero-demo [data-chat-thinking], .agent-hero-demo .agent-window-bar')).toHaveCount(0);
      await expect(page.locator('.agent-hero-demo')).not.toContainText('receipt-024.pdf');
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
      await expect(page.locator('.agent-hero-demo input, .agent-hero-demo button, [data-chat-composer]')).toHaveCount(0);
      await page.emulateMedia({reducedMotion:'reduce'});
      await expect(page.locator('[data-conversation-turn]:not([hidden])')).toHaveCount(3);
      await expect(page.locator('[data-conversation-turn]').nth(1).locator('[data-chat-evidence]')).toContainText('−Rp8.000.000');
      await expect(page.locator('[data-agent-conversation]')).toHaveAttribute('data-chat-turn','2');
      await expect(page.locator('[data-conversation-turn]').nth(2).locator('[data-chat-answer]')).toContainText('Rp29.400.000');
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
    await context.route('https://fonts.googleapis.com/**', route=>route.fulfill({status:200,contentType:'text/css',body:''}));
    await context.route('https://www.googletagmanager.com/**', route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
    const page=await context.newPage();
    await page.goto(route,{waitUntil:'domcontentloaded'});
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.agent-window')).toHaveCount(8);
    await expect(page.locator('[data-conversation-turn]')).toHaveCount(3);
    await expect(page.locator('[data-conversation-turn]').last()).toContainText('Rp29.400.000');
    await expect(page.locator('[data-chat-composer], [data-chat-send]')).toHaveCount(0);
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
for (const width of [390,1440]) test('hero motion continues without hovering after the intro '+width,async ({page})=>{
  await page.setViewportSize({width,height:900});
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
  await context.route('https://www.googletagmanager.com/**', route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
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
  await expect(page.locator('[data-agent-conversation]')).toHaveAttribute('data-chat-motion','static');
  await expect(page.locator('[data-conversation-turn]:not([hidden])')).toHaveCount(3);
  await expect(page.locator('[data-chat-composer]')).toHaveCount(0);
  await context.close();
});
for (const locale of ['en','id']) for (const width of [390,1440]) {
  test(`conversation types in bubbles, answers immediately and retains history ${locale} ${width}`,async ({page})=>{
    // Advance all three exchanges, including the live canvas background.
    test.setTimeout(60000);
    const start=new Date('2026-09-29T00:00:00Z');
    await page.clock.install({time:start});
    await page.clock.pauseAt(start); // Sample the 260ms reveal without wall-clock races.
    await page.setViewportSize({width,height:900});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(locale==='id'?'/id/aiagents':'/aiagents',{waitUntil:'domcontentloaded'});
    const demo=page.locator('[data-agent-conversation]');
    await demo.scrollIntoViewIfNeeded();
    await expect(demo).toHaveAttribute('data-chat-motion','running');
    const question=await page.locator('[data-chat-transcript-body] p').first().textContent();
    const answer=await page.locator('[data-chat-answer]').first().textContent();
    await expect(page.locator('[data-conversation-turn]').first()).toBeVisible();
    await expect(page.locator('[data-chat-response]').first()).toBeHidden();
    await expect(page.locator('.agent-hero-demo input, .agent-hero-demo [placeholder]')).toHaveCount(0);
    await page.clock.runFor(200);
    const typed=await page.locator('[data-chat-question]').first().textContent();
    expect(typed.length).toBeGreaterThan(0);
    expect(typed.length).toBeLessThan(question.length);
    await page.clock.runFor(question.length*28+100);
    await expect(demo).toHaveAttribute('data-chat-phase','responding');
    const partial=await page.locator('[data-chat-answer]').first().textContent();
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(answer.length);
    await page.clock.runFor(300);
    await expect(demo).toHaveAttribute('data-chat-phase','reading');
    await expect(page.locator('[data-chat-question]').first()).toHaveText(question);
    await expect(page.locator('[data-chat-answer]').first()).toHaveText(answer);
    await expect(page.locator('[data-chat-thinking]')).toHaveCount(0);
    await expect(page.locator('[data-chat-evidence]').first()).toBeVisible();
    // Catch the second question typing while the complete first exchange remains.
    for(let i=0;i<50;i++){
      if(await demo.getAttribute('data-chat-turn')==='1') break;
      await page.clock.runFor(100);
    }
    await expect(demo).toHaveAttribute('data-chat-turn','1');
    await expect(demo).toHaveAttribute('data-chat-phase','typing');
    await page.clock.runFor(150);
    expect((await page.locator('[data-chat-question]').nth(1).textContent()).length).toBeGreaterThan(0);
    await expect(page.locator('[data-chat-response]').nth(1)).toBeHidden();
    await expect(page.locator('[data-chat-response]').first()).toBeVisible();
    await expect(page.locator('[data-chat-question]').first()).toHaveText(question);
    await expect(page.locator('[data-chat-answer]').first()).toHaveText(answer);
    for(let i=0;i<12;i++){
      if(await demo.getAttribute('data-chat-phase')==='complete') break;
      await page.clock.runFor(1000);
    }
    await page.clock.runFor(1000); // Allow native smooth scrolling to settle.
    await expect(demo).toHaveAttribute('data-chat-turn','2');
    await expect(demo).toHaveAttribute('data-chat-phase','complete');
    await expect(page.locator('[data-conversation-turn]:not([hidden])')).toHaveCount(3);
    await expect(page.locator('[data-chat-response]:not([hidden])')).toHaveCount(3);
    expect(await page.locator('[data-conversation-log]').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThanOrEqual(2);
    await page.locator('[data-conversation-log]').focus();
    await page.clock.runFor(8000);
    await expect(demo).toHaveAttribute('data-chat-motion','paused');
    await expect(demo).toHaveAttribute('data-chat-turn','2');
    await expect(page.locator('[data-chat-question]').first()).toHaveText(question);
    await expect(page.locator('[data-chat-answer]').first()).toHaveText(answer);
    await page.locator('[data-conversation-log]').evaluate(log=>log.scrollTo({top:0,behavior:'instant'}));
    expect(await page.locator('[data-conversation-log]').evaluate(log=>log.scrollTop)).toBe(0);
    await page.locator('[data-conversation-log]').evaluate(log=>log.blur());
    await expect(demo).toHaveAttribute('data-chat-motion','running');
    await page.clock.runFor(5200);
    await expect(demo).toHaveAttribute('data-chat-cycle','1');
    await expect(demo).toHaveAttribute('data-chat-turn','0');
    await expect(page.locator('[data-conversation-turn]:not([hidden])')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}
test('conversation pauses for keyboard reading without changing earlier messages',async ({page})=>{
  test.setTimeout(60000);
  await page.clock.install();
  await page.goto('/aiagents',{waitUntil:'domcontentloaded'});
  const demo=page.locator('[data-agent-conversation]');
  await demo.scrollIntoViewIfNeeded();
  await expect(demo).toHaveAttribute('data-chat-motion','running');
  await page.clock.runFor(2000);
  await expect(demo).toHaveAttribute('data-chat-phase','reading');
  await expect(page.locator('[data-chat-evidence]').first()).toBeVisible();
  await page.locator('[data-conversation-log]').focus();
  await expect(demo).toHaveAttribute('data-chat-motion','paused');
  await page.clock.runFor(6000);
  await expect(demo).toHaveAttribute('data-chat-turn','0');
  await expect(page.locator('[data-chat-transcript-body]')).toContainText('Rp60.000.000');
  await expect(page.locator('[data-chat-transcript-body]')).toContainText('Rp29.400.000');
  await page.locator('[data-conversation-log]').evaluate(log=>log.blur());
  await expect(demo).toHaveAttribute('data-chat-motion','running');
});
test('saved Indonesian preference also localizes the animated conversation',async ({page})=>{
  await page.addInitScript(()=>localStorage.setItem('fluxyos-lang','id'));
  await page.goto('/aiagents',{waitUntil:'domcontentloaded'});
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('[data-chat-question]').first()).toHaveText('Bagaimana pendapatan saya bulan ini?');
  await expect(page.locator('[data-chat-answer]').first()).toContainText('Pendapatan September');
  await expect(page.locator('[data-chat-transcript-body]')).toContainText('Apa penyebab penurunannya?');
});
test('autoplay pauses outside the viewport and resumes when visible',async ({page})=>{
  await page.clock.install();
  await page.goto('/aiagents',{waitUntil:'domcontentloaded'});
  const demo=page.locator('[data-agent-conversation]');
  await demo.scrollIntoViewIfNeeded();
  await expect(demo).toHaveAttribute('data-chat-motion','running');
  await page.locator('.agent-faq').scrollIntoViewIfNeeded();
  await expect(demo).toHaveAttribute('data-chat-motion','paused');
  const phase=await demo.getAttribute('data-chat-phase');
  await page.clock.runFor(4000);
  await expect(demo).toHaveAttribute('data-chat-phase',phase);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo).toHaveAttribute('data-chat-motion','running');
});
