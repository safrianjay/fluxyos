const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
async function open(page, route) {
  // Semantic interaction/overflow checks use the browser's sans-serif fallback.
  // Actual Inter typography is checked separately in desktop/tablet/mobile
  // screenshots and Lighthouse, without intercepting the font stylesheet.
  await page.route('https://fonts.googleapis.com/**', request =>
    request.fulfill({status:200,contentType:'text/css',body:''}));
  // These read-only UI tests should not depend on external analytics responding.
  await page.route('https://www.googletagmanager.com/**', request =>
    request.fulfill({status:200,contentType:'application/javascript',body:''}));
  await page.goto(route,{waitUntil:'domcontentloaded'});
}
for (const locale of ['en','id']) {
  const prefix = locale === 'id' ? '/id' : '';
  const route = prefix + '/accounting-automation';
  test(locale + ' responsive page, navigation, metadata and FAQ', async ({page}) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await open(page,route);
    await expect(page.locator('html')).toHaveAttribute('lang',locale);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toBeVisible();
    for (const width of [1440,1024,768,390,360]) {
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect(page.locator('.auto-hero-demo')).toBeVisible();
      expect(await page.locator('.auto-hero-demo').evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(width);
      if (width < 1024) {
        const toggle = page.locator('nav .mobile-menu-toggle');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded','true');
        const link = page.locator('#mobile-menu a[href="'+route+'"]');
        await expect(link).toHaveCount(1);
        await expect(link).toContainText('Accounting Automation');
        await expect(page.locator('#mobile-menu a[href="'+prefix+'/multi-currency"]')).toHaveCount(1);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded','false');
      }
    }
    const schemas = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes =>
      nodes.flatMap(node => { const value = JSON.parse(node.textContent); return value['@graph'] || (Array.isArray(value) ? value : [value]); }));
    for (const type of ['Organization','SoftwareApplication','BreadcrumbList','FAQPage']) expect(schemas.some(s => s['@type'] === type)).toBe(true);
    const faq = schemas.find(s => s['@type'] === 'FAQPage').mainEntity;
    await expect(page.locator('.auto-faq details')).toHaveCount(faq.length);
    for (let index=0;index<faq.length;index++) {
      const item = page.locator('.auto-faq details').nth(index);
      expect((await item.locator('summary').innerText()).replace(/\s*\+$/,'').trim()).toBe(faq[index].name);
      await expect(item.locator('p')).toHaveText(faq[index].acceptedAnswer.text);
    }
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://fluxyos.com'+route);
    await expect(page.locator('link[hreflang="en"]')).toHaveAttribute('href','https://fluxyos.com/accounting-automation');
    await expect(page.locator('link[hreflang="id"]')).toHaveAttribute('href','https://fluxyos.com/id/accounting-automation');
    await expect(page.locator('meta[property="og:locale:alternate"]')).toHaveAttribute('content',locale === 'id' ? 'en_US' : 'id_ID');
    if (locale === 'id') {
      expect(await page.locator('.auto-page').innerText()).not.toMatch(/Connected activity|Sample workspace|Cash & bank|Accounts receivable|Office supplies|Sales revenue|Revenue \/ Expenses/);
    }
    expect((await page.title()).length).toBeLessThanOrEqual(60);
    expect((await page.locator('meta[name="description"]').getAttribute('content')).length).toBeLessThanOrEqual(160);
    for (const area of ['.auto-hero','.auto-closing']) {
      await expect(page.locator(area+' a[href="'+prefix+'/pricing"]')).toHaveCount(1);
      // Contact sales remains the shared EN conversion page in both locales.
      await expect(page.locator(area+' a[href="/contact-sales"]')).toHaveCount(1);
    }
    await page.locator('.footer-component').scrollIntoViewIfNeeded();
    await expect(page.locator('.footer-component')).toBeVisible();
    expect(errors).toEqual([]);
  });
  test(locale + ' native source, ledger, report, AI and match interactions', async ({page}) => {
    await open(page,route);
    for (let index=0;index<5;index++) {
      await page.locator('[data-hero-source-button]').nth(index).click();
      await expect(page.locator('.auto-hero-demo')).toHaveAttribute('data-hero-source',String(index));
      await expect(page.locator('.auto-hero-demo')).toHaveAttribute('data-hero-stage','3');
      await expect(page.locator('[data-hero-entry]').nth(index).locator('[data-hero-reveal="3"]')).toHaveAttribute('aria-hidden','false');
      await expect(page.locator('[data-hero-entry]').nth(index)).toBeVisible();
      await page.locator('[data-source-button]').nth(index).click();
      await expect(page.locator('[data-source-panel]').nth(index)).toBeVisible();
      await expect(page.locator('[data-source-button]').nth(index)).toHaveAttribute('aria-pressed','true');
      await page.locator('[data-ledger-source]').nth(index).click();
      await expect(page.locator('[data-ledger-detail]').nth(index)).toBeVisible();
    }
    const tabs = page.locator('[data-report-tab]');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected','true');
    await expect(page.locator('[data-report-panel]').nth(1)).toBeVisible();
    await page.keyboard.press('End');
    await expect(tabs.nth(2)).toBeFocused();
    await expect(page.locator('[data-report-panel]').nth(2)).toBeVisible();
    await page.keyboard.press('Home');
    await expect(tabs.first()).toBeFocused();
    await expect(page.locator('[data-report-panel]').first()).toContainText('Rp1.280.000');
    await page.locator('[data-ai-question]').nth(1).click();
    await expect(page.locator('#auto-ai-answer-1')).toBeVisible();
    await expect(page.locator('#auto-ai-answer-1')).toContainText('Rp100.000');
    await page.locator('[data-match-example]').click();
    await expect(page.locator('[data-match-confirmed]')).toBeVisible();
    await expect(page.locator('.auto-reconcile')).toHaveAttribute('data-matched','true');
  });
  test(locale + ' hero autoplay moves on desktop and mobile; focus pauses', async ({page}) => {
    await open(page,route);
    const hero = page.locator('.auto-hero-demo');
    for (const width of [1440,390]) {
      await page.setViewportSize({width,height:900});
      await hero.scrollIntoViewIfNeeded();
      await expect(hero).toHaveAttribute('data-motion','running');
      const stage = await hero.getAttribute('data-hero-stage');
      await expect.poll(() => hero.getAttribute('data-hero-stage'),{timeout:3500}).not.toBe(stage);
      const cursor = page.locator('[data-hero-entry]:not([hidden]) .auto-posting-cursor');
      const first = await cursor.evaluate(node => getComputedStyle(node).transform);
      await expect.poll(() => cursor.evaluate(node => getComputedStyle(node).transform),{timeout:3500}).not.toBe(first);
      await page.locator('[data-hero-source-button]').first().focus();
      await expect(hero).toHaveAttribute('data-motion','paused');
      const held = await hero.getAttribute('data-hero-stage');
      await page.waitForTimeout(1400);
      await expect(hero).toHaveAttribute('data-hero-stage',held);
      await page.locator('[data-hero-source-button]').first().evaluate(node => node.blur());
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    await expect(hero).toHaveAttribute('data-motion','paused');
    await expect(hero).toHaveAttribute('data-hero-stage','3');
  });
  test(locale + ' reduced motion and no-JavaScript content', async ({browser}) => {
    const reducedContext = await browser.newContext({reducedMotion:'reduce'});
    const page = await reducedContext.newPage();
    await open(page,'http://127.0.0.1:8765'+route);
    await expect(page.locator('.auto-hero-demo')).toHaveAttribute('data-motion','paused');
    await expect(page.locator('.auto-hero-demo')).toHaveAttribute('data-hero-stage','3');
    expect(await page.locator('.auto-posting-cursor').first().evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    await reducedContext.close();
    const context = await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:900}});
    const noJS = await context.newPage();
    await open(noJS,'http://127.0.0.1:8765'+route);
    for (const panel of await noJS.locator('[data-report-panel], [data-source-panel]').all()) await expect(panel).toBeVisible();
    await expect(noJS.locator('.auto-faq details')).toHaveCount(6);
    await expect(noJS.locator('.auto-workload-card')).toHaveCount(4);
    await expect(noJS.locator('[data-workload-fluxy]')).toHaveCount(4);
    await expect(noJS.locator('[data-workload-fluxy]').last()).toHaveText('60');
    await expect(noJS.locator('.auto-workload-manual')).toHaveCount(4);
    await expect(noJS.locator('.auto-workload-comparison')).toHaveCount(0);
    expect(await noJS.locator('.auto-workload-fill').first().evaluate(
      node => getComputedStyle(node).transform)).toBe('none');
    await expect(noJS.locator('.footer-component')).toBeVisible();
    expect(await noJS.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await context.close();
  });
  test(locale + ' original rising cards, minute estimates, manual comparison and motion', async ({page}) => {
    await open(page,route);
    const cards = page.locator('.auto-workload-cards');
    await expect(cards.locator('li')).toHaveCount(4);
    await expect(cards.locator('.auto-workload-fill')).toHaveCount(4);
    await expect(page.locator('.auto-workload-controls,.auto-workload-column,.auto-workload-comparison')).toHaveCount(0);
    expect(await cards.locator('[data-workload-fluxy]').allTextContents()).toEqual(['10','20','40','60']);
    expect(await cards.locator('[data-workload-manual]').allTextContents()).toEqual(['≈8','≈17','≈33','≈50']);
    await expect(cards.locator('[data-time-basis="usage-estimate"]')).toHaveCount(1);
    await expect(cards.locator('[data-time-basis="scaled-estimate"]')).toHaveCount(3);
    for (const card of await cards.locator('li').all()) {
      await expect(card.locator('.auto-workload-value')).toContainText(locale === 'id' ? 'Dengan FluxyOS' : 'With FluxyOS');
      await expect(card.locator('.auto-sr-only')).toHaveText(locale === 'id' ? 'Kurang dari' : 'Less than');
      await expect(card.locator('.auto-workload-manual p')).toContainText(locale === 'id' ? 'jam secara manual' : 'hours manually');
    }
    await expect(page.locator('.auto-workload-context')).toContainText(
      locale === 'id' ? 'bukan hasil pengukuran terpisah' : 'not independently measured');
    for (const width of [1440,1024,768,390,320]) {
      await page.setViewportSize({width,height:1000});
      await cards.scrollIntoViewIfNeeded();
      const positions = await cards.locator('li').evaluateAll(nodes => nodes.map(node => ({
        top:Math.round(node.getBoundingClientRect().top),width:node.getBoundingClientRect().width
      })));
      expect(positions[0].top).toBe(positions[1].top);
      if (width > 900) expect(positions[2].top).toBe(positions[0].top);
      else expect(positions[2].top).toBeGreaterThan(positions[0].top);
      expect(await cards.locator('li').evaluateAll(nodes => nodes.every(node => {
        const card = node.getBoundingClientRect();
        return Array.from(node.querySelectorAll('.auto-workload-time,.auto-workload-time strong,.auto-workload-manual')).every(child => {
          const bounds = child.getBoundingClientRect();
          return bounds.left >= card.left && bounds.right <= card.right &&
            bounds.top >= card.top && bounds.bottom <= card.bottom;
        });
      }))).toBe(true);
      expect(positions.every(position => position.width > 100)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await expect(cards).toHaveClass(/is-visible/);
    await expect.poll(() => cards.locator('.auto-workload-fill').first().evaluate(
      node => getComputedStyle(node).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
    await page.emulateMedia({reducedMotion:'reduce'});
    expect(await cards.locator('.auto-workload-fill').first().evaluate(
      node => getComputedStyle(node).animationName)).toBe('none');
  });
  test(locale + ' scroll-linked source story and balanced journal data', async ({page}) => {
    await page.setViewportSize({width:1440,height:900});
    await open(page,route);
    await page.locator('#source-step-4').scrollIntoViewIfNeeded();
    await expect(page.locator('.auto-source-story')).toHaveAttribute('data-source','4');
    await expect(page.locator('.auto-hero-demo')).toHaveAttribute('data-motion','paused');
    expect(await page.locator('.auto-source-demo').evaluate(node => getComputedStyle(node).position)).toBe('sticky');
    const amounts = [185000,1500000,320000,600000,85000];
    for (let index=0;index<5;index++) {
      const lines = await page.locator('[data-source-panel]').nth(index).locator('tbody tr').evaluateAll(rows =>
        rows.map(row => Array.from(row.querySelectorAll('td')).slice(1).map(cell => Number(cell.textContent.replace(/\D/g,'')))));
      expect(lines.reduce((sum,line) => sum+line[0],0)).toBe(amounts[index]);
      expect(lines.reduce((sum,line) => sum+line[1],0)).toBe(amounts[index]);
    }
    expect(await page.locator('body').innerText()).not.toMatch(/\bundefined\b/);
  });
}
test('linked journal fixture and branded OG dimensions', async () => {
  const html = fs.readFileSync(path.join(__dirname,'../accounting-automation.html'),'utf8');
  const source = html.match(/<div class="auto-source-story"[\s\S]*?<section class="auto-section auto-ledger-section"/)?.[0] || html;
  for (const value of ['Rp185.000','Rp1.500.000','Rp320.000','Rp600.000','Rp85.000','Rp2.690.000']) expect(html).toContain(value);
  expect(185000+1500000+320000+600000+85000).toBe(2690000);
  expect(1685000-405000).toBe(1280000);
  expect(100000+1500000+600000).toBe(320000+600000+1280000);
  expect(source).toContain('2050');
  const png = fs.readFileSync(path.join(__dirname,'../assets/images/og-accounting-automation.png'));
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
});
