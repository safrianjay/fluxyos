const {test,expect}=require('@playwright/test');
const {pages}=require('../scripts/sync-marketing-nav.js');
const publicPages=pages();
for(const file of pages()) test('shared navbar '+file,async({page})=>{
  const prefix=file.startsWith('id/')?'/id':'';
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/'+file.replace(/\.html$/,''),{waitUntil:'domcontentloaded'});
  const nav=page.locator('nav[data-animate="nav"]');
  await expect(nav).toHaveCount(1);
  if(prefix) await expect(nav.locator('a').filter({hasText:/^English \(EN\)$/})).toHaveAttribute('href','/'+file.slice(3).replace(/\.html$/,''));
  else if(publicPages.includes('id/'+file)) await expect(nav.locator('a').filter({hasText:/^Bahasa \(ID\)$/})).toHaveAttribute('href','/id/'+file.replace(/\.html$/,''));
  await expect(nav).toBeVisible();
  await nav.locator('button').first().hover();
  for(const slug of ['aiagents','point-of-sale','erp-intelligence','budgetlanding','revenuesync','receiptcapture','vendorspend']){
    await expect(nav.locator('a[href="'+prefix+'/'+slug+'"]').first()).toBeVisible();
  }
  for(const width of [768,390]){
    await page.setViewportSize({width,height:900});
    const toggle=nav.locator('.mobile-menu-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded','true');
    await expect(nav.locator('#mobile-menu')).toBeVisible();
    for(const slug of ['aiagents','point-of-sale','erp-intelligence','customers','receiptcapture','budgetlanding','revenuesync','vendorspend']){
      await expect(nav.locator('#mobile-menu a[href="'+prefix+'/'+slug+'"]')).toHaveCount(1);
    }
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded','false');
    await expect(nav.locator('#mobile-menu')).toBeHidden();
    const bounds=await nav.evaluate(n=>n.getBoundingClientRect().toJSON());
    expect(bounds.width).toBeLessThanOrEqual(width);
  }
  expect(errors).toEqual([]);
});
test('language menu navigates between matching guide pages',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/guides/erp-intelligence');
  await page.locator('nav button').nth(2).hover();
  await page.locator('nav a').filter({hasText:/^Bahasa \(ID\)$/}).click();
  await expect(page).toHaveURL(/\/id\/guides\/erp-intelligence$/);
  await expect(page.locator('html')).toHaveAttribute('lang','id');
  await page.locator('nav button').nth(2).hover();
  await page.locator('nav a').filter({hasText:/^English \(EN\)$/}).click();
  await expect(page).toHaveURL(/\/guides\/erp-intelligence$/);
  await expect(page.locator('html')).toHaveAttribute('lang','en');
});
