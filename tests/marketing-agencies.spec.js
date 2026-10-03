const {test,expect}=require('@playwright/test');
for(const locale of ['en','id']) for(const width of [1440,768,390,320]) {
 test(`${locale} at ${width}: layout, routes, schema, keyboard and console`,async({page,request})=>{
  const failures=[];
  page.on('pageerror',e=>failures.push(e.message));
  page.on('console',m=>{if(m.type()==='error')failures.push(m.text());});
  await page.setViewportSize({width,height:900});
  const route=`/${locale==='id'?'id/':''}use-cases/marketing-agencies`;
  await page.goto(route,{waitUntil:'domcontentloaded'});
  await expect(page.locator('.footer-component')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang',locale);
  await expect(page.locator('h1')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  for(let y=0;y<await page.evaluate(()=>document.documentElement.scrollHeight);y+=700){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(30);}
  await expect(page.locator('.ag-reveal').last()).toHaveClass(/is-visible/);
  const links=await page.locator('main a').evaluateAll(es=>[...new Set(es.map(e=>e.getAttribute('href')).filter(h=>h.startsWith('/')&&!h.startsWith('//')))]);
  for(const href of links)expect((await request.get(href)).status(),href).toBe(200);
  const schemas=await page.locator('script[type="application/ld+json"]').allTextContents();
  const parsed=schemas.map(s=>JSON.parse(s));
  expect(parsed.map(s=>s['@type'])).toEqual(expect.arrayContaining(['Organization','SoftwareApplication','BreadcrumbList','FAQPage']));
  const faq=parsed.find(s=>s['@type']==='FAQPage');
  expect(faq.mainEntity).toHaveLength(await page.locator('.ag-faq').count());
  for(const [i,item] of faq.mainEntity.entries()){
   const detail=page.locator('.ag-faq').nth(i);
   expect(await detail.locator('summary').innerText()).toContain(item.name);
   expect(await detail.locator('p').textContent()).toBe(item.acceptedAnswer.text);
  }
  await page.locator('[data-ag-next]').click();
  await expect(page.locator('[data-ag-status]')).toHaveText(`${locale==='en'?'Step':'Langkah'} 2 / 3`);
  const carousel=page.locator('.ag-carousel');await carousel.focus();await page.keyboard.press('End');
  await expect(page.locator('[data-ag-status]')).toHaveText(`${locale==='en'?'Step':'Langkah'} 3 / 3`);
  await expect(page.locator('[data-ag-next]')).toBeDisabled();
  await page.keyboard.press('Home');await expect(page.locator('[data-ag-prev]')).toBeDisabled();
  await page.locator('.ag-faq summary').first().focus();await page.keyboard.press('Enter');
  await expect(page.locator('.ag-faq').first()).toHaveAttribute('open','');
  await page.keyboard.press('Enter');await expect(page.locator('.ag-faq').first()).not.toHaveAttribute('open','');
  await page.evaluate(()=>scrollTo(0,0));
  if(width<1024){
   const toggle=page.locator('.mobile-menu-toggle');await toggle.click();
   await expect(toggle).toHaveAttribute('aria-expanded','true');
   await page.locator('#mobile-menu a').first().focus();await page.keyboard.press('Escape');
   await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(toggle).toBeFocused();
  }else{
   const trigger=page.locator('[aria-controls="agency-nav-panel-0"]');await trigger.focus();await page.keyboard.press('ArrowDown');
   await expect(page.locator('#agency-nav-panel-0 a').first()).toBeFocused();await page.keyboard.press('Escape');
   await expect(trigger).toBeFocused();await expect(trigger).toHaveAttribute('aria-expanded','false');
  }
  expect(failures).toEqual([]);
 });
}
test('reduced motion, saved language and no-JS content',async({browser})=>{
 const context=await browser.newContext({reducedMotion:'reduce'});const page=await context.newPage();await page.goto('/use-cases/marketing-agencies');
 expect(await page.locator('.ag-enter').first().evaluate(e=>getComputedStyle(e).animationName)).toBe('none');
 expect(await page.locator('.ag-atmosphere-band').first().evaluate(e=>getComputedStyle(e).animationName)).toBe('none');
 await expect(page.locator('main')).not.toHaveClass(/ag-motion-ready/);
 await page.locator('[data-ag-next]').click();await expect(page.locator('[data-ag-status]')).toHaveText('Step 2 / 3');
 await page.evaluate(()=>localStorage.setItem('fluxyos-lang','id'));await page.goto('/use-cases/marketing-agencies');await expect(page).toHaveURL(/\/id\/use-cases\/marketing-agencies/);
 await expect(page.locator('h1')).toContainText('Kreativitas hebat.');await context.close();
 const nojs=await browser.newContext({javaScriptEnabled:false});const fallback=await nojs.newPage();await fallback.goto('/use-cases/marketing-agencies');
 await expect(fallback.locator('h1')).toBeVisible();await expect(fallback.locator('.ag-challenge').first()).toBeVisible();
 expect(await fallback.locator('.ag-carousel').evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);await nojs.close();
});

test('hero background moves, settles and never blocks content', async({page})=>{
 await page.goto('/use-cases/marketing-agencies',{waitUntil:'domcontentloaded'});
 const motion=await page.locator('.ag-hero-atmosphere').evaluate(el=>{
  const animations=el.getAnimations({subtree:true});
  const band=el.querySelector('.ag-atmosphere-band');
  animations.forEach(a=>{a.pause();a.currentTime=100;});
  const start=getComputedStyle(band).transform;
  animations.forEach(a=>a.currentTime=2400);
  const middle=getComputedStyle(band).transform;
  const timings=animations.map(a=>a.effect.getTiming());
  animations.forEach(a=>a.finish());
  return {start,middle,timings,position:getComputedStyle(el).position,zIndex:getComputedStyle(el).zIndex,pointer:getComputedStyle(el).pointerEvents,states:animations.map(a=>a.playState)};
 });
 expect(motion.start).not.toBe(motion.middle);
 expect(motion.timings).toHaveLength(3);
 motion.timings.forEach(t=>{expect(t.duration).toBeLessThanOrEqual(5000);expect(t.iterations).toBe(1);});
 expect(motion.position).toBe('absolute');
 expect(motion.zIndex).toBe('-1');
 expect(motion.pointer).toBe('none');
 expect(motion.states.every(s=>s==='finished')).toBe(true);
 await expect(page.locator('.ag-hero-atmosphere')).toHaveAttribute('aria-hidden','true');
 await expect(page.locator('.ag-hero .ag-primary')).toBeVisible();
});
