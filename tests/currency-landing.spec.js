const {test, expect} = require('./public-test');

test.beforeEach(async ({page}) => {
  // These local interaction tests must not wait on third-party fonts or
  // analytics. Real typography is checked separately with Lighthouse and
  // visual QA; every product stylesheet, script and interaction stays live.
  await page.route('https://fonts.googleapis.com/**', route =>
    route.fulfill({status: 200, contentType: 'text/css', body: ''}));
  await page.route('https://www.googletagmanager.com/**', route =>
    route.fulfill({status: 200, contentType: 'application/javascript', body: ''}));
});

for (const locale of ['en', 'id']) {
  const prefix = locale === 'id' ? '/id' : '';
  const route = prefix + '/multi-currency';
  for (const width of [360, 390, 768, 1024, 1440]) {
    test(`Currency ${locale} responsive and interactive ${width}px`, async ({page}) => {
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.setViewportSize({width, height: 900});
      expect((await page.goto(route)).ok()).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('h1')).toBeInViewport();
      const hero = page.locator('.currency-hero-demo');
      await hero.scrollIntoViewIfNeeded();
      await expect(hero).toHaveAttribute('data-motion', 'running');
      const cursor = hero.locator('.currency-timeline-cursor');
      const before = await cursor.evaluate(el => getComputedStyle(el).left);
      await page.waitForTimeout(500);
      expect(await cursor.evaluate(el => getComputedStyle(el).left)).not.toBe(before);
      const routeLine = page.locator('.currency-route-motion');
      const routeBefore = await routeLine.evaluate(el => getComputedStyle(el).strokeDashoffset);
      await page.waitForTimeout(250);
      expect(await routeLine.evaluate(el => getComputedStyle(el).strokeDashoffset)).not.toBe(routeBefore);
      for (const code of ['MYR', 'PHP', 'IDR', 'SGD']) {
        await page.locator(`[data-hero-market="${code}"]`).click();
        await expect(hero).toHaveAttribute('data-hero-currency', code);
        await expect(page.locator('[data-hero-code]')).toHaveText(code);
        await expect(page.locator(`[data-event="${code}"]`)).toHaveClass(/is-active/);
      }
      await expect(page.locator('.currency-hero .currency-primary')).toHaveAttribute('href', prefix + '/pricing');
      await expect(page.locator('.currency-hero .currency-button').nth(1)).toHaveAttribute('href', '/contact-sales');
      for (const chart of await page.locator('.currency-chart').all()) {
        const dims = await chart.evaluate(el => ({width:el.clientWidth, scroll:el.scrollWidth}));
        expect(dims.scroll).toBeLessThanOrEqual(dims.width + 1);
      }
      for (let index = 0; index < 4; index++) {
        const step = page.locator('[data-flow-step]').nth(index);
        await step.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator(`#currency-flow-${index}`)).toBeVisible();
        await expect(step).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.currency-flow-panel:visible')).toHaveCount(1);
      }
      const stepLayout = await page.locator('.currency-step').evaluateAll(nodes => nodes.map(node => {
        const title = node.querySelector('b').getBoundingClientRect();
        const copy = node.querySelector('p').getBoundingClientRect();
        const number = node.querySelector('small').getBoundingClientRect();
        const style = getComputedStyle(node);
        return {title: title.left, copy: copy.left, number: number.left, top: style.paddingTop, bottom: style.paddingBottom};
      }));
      for (const step of stepLayout) {
        expect(step.title).toBe(stepLayout[0].title);
        expect(step.copy).toBe(step.title);
        expect(step.number).toBe(stepLayout[0].number);
        expect(parseInt(step.top)).toBeGreaterThanOrEqual(20);
        expect(parseInt(step.bottom)).toBeGreaterThanOrEqual(24);
      }
      await expect(page.locator('.currency-review-wide')).toBeVisible();
      await expect(page.locator('.currency-review-card')).toHaveCount(2);
      expect(await page.locator('.currency-review').evaluate(node =>
        !!(node.compareDocumentPosition(document.querySelector('.currency-reporting')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
      await expect(page.locator('.currency-table tfoot td')).toHaveText(['Rp320.000', 'Rp320.000']);
      for (const code of ['MYR', 'PHP', 'IDR', 'SGD']) {
        const button = page.locator(`[data-report-market="${code}"]`);
        await button.focus(); await page.keyboard.press('Space');
        await expect(page.locator('.currency-report-demo')).toHaveAttribute('data-report-currency', code);
        const values = await page.locator('.currency-report-metrics [data-report-value]').allTextContents();
        const expected = await page.evaluate(c => {
          const v = {SGD:[245000,68000,177000], MYR:[245000,68000,177000], PHP:[2450000,680000,1770000], IDR:[24500000,6800000,17700000]};
          return v[c].map(n => window.FluxyMoney.formatMoney(n,c));
        }, code);
        expect(values).toEqual(expected);
        const reference = await page.evaluate(c => {
          const factor = {SGD:100,MYR:100,PHP:1000,IDR:10000}[c];
          return [1900,2300,150].map(n => window.FluxyMoney.formatMoney(n*factor,c));
        }, code);
        await expect(page.locator('[data-chart-low]')).toHaveText(reference[0]);
        await expect(page.locator('[data-chart-high]')).toHaveText(reference[1]);
        await expect(page.locator('[data-chart-difference]')).toHaveText(reference[2]);
      }
      await page.locator('[data-chart-month="3"]').click();
      await expect(page.locator('[data-chart-relation="above"]')).toBeVisible();
      await page.keyboard.press('ArrowLeft');
      await expect(page.locator('[data-chart-month="2"]')).toBeFocused();
      await expect(page.locator('[data-chart-relation="within"]')).toBeVisible();
      await expect(page.locator('[data-chart-actual]')).toHaveText('S$1,880.00');
      await page.keyboard.press('Home');
      await expect(page.locator('[data-chart-month="0"]')).toBeFocused();
      await page.keyboard.press('End');
      await expect(page.locator('[data-chart-month="5"]')).toBeFocused();
      await expect(page.locator('[data-chart-actual]')).toHaveText('S$2,450.00');
      const dot = await page.locator('.currency-chart-point.is-selected').boundingBox();
      expect(dot.width).toBe(dot.height);
      const band = await page.locator('.currency-reference-band').boundingBox();
      expect(band.height).toBeGreaterThan(24);
      await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://fluxyos.com' + route);
      await expect(page.locator('link[hreflang=en]')).toHaveAttribute('href', 'https://fluxyos.com/multi-currency');
      await expect(page.locator('link[hreflang=id]')).toHaveAttribute('href', 'https://fluxyos.com/id/multi-currency');
      const schemas = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.map(n=>JSON.parse(n.textContent)));
      for (const type of ['Organization','SoftwareApplication','BreadcrumbList','FAQPage']) expect(schemas.some(s=>s['@type']===type)).toBe(true);
      const faq = schemas.find(s=>s['@type']==='FAQPage').mainEntity;
      await expect(page.locator('.currency-faq details')).toHaveCount(faq.length);
      for (let index=0; index<faq.length; index++) {
        const item=page.locator('.currency-faq details').nth(index);
        expect((await item.locator('summary').innerText()).replace(/\s*\+$/,'').trim()).toBe(faq[index].name);
        await expect(item.locator('p')).toHaveText(faq[index].acceptedAnswer.text);
      }
      await page.locator('.footer-component').scrollIntoViewIfNeeded();
      await expect(page.locator('.footer-component')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
      if (width < 1024) {
        await page.locator('.mobile-menu-toggle').click();
        await expect(page.locator(`#mobile-menu a[href="${route}"]`)).toBeVisible();
        await page.locator('.mobile-menu-toggle').click();
      } else {
        await page.locator('nav button').first().hover();
        await expect(page.locator(`nav a[href="${route}"]`).first()).toBeVisible();
      }
      expect(errors).toEqual([]);
    });
  }
  for (const width of [390,1440]) {
    test(`Currency ${locale} automatic motion ${width}px`, async ({page}) => {
      await page.clock.install();
      await page.setViewportSize({width,height:900});
      await page.goto(route);
      const hero=page.locator('.currency-hero-demo');
      await hero.scrollIntoViewIfNeeded();
      await expect(hero).toHaveAttribute('data-motion','running');
      for (const code of ['MYR','PHP','IDR','SGD']) {
        await page.clock.runFor(4000);
        await expect(hero).toHaveAttribute('data-hero-currency',code);
      }
      const workflow=page.locator('.currency-workflow');
      await workflow.scrollIntoViewIfNeeded();
      await expect(workflow).toHaveAttribute('data-motion','running');
      for (const index of ['1','2','3','0']) {
        await page.clock.runFor(5000);
        await expect(workflow).toHaveAttribute('data-flow-stage',index);
      }
      await page.locator('[data-flow-step="2"]').click();
      await expect(workflow).toHaveAttribute('data-motion','paused');
      await page.clock.runFor(10000);
      await expect(workflow).toHaveAttribute('data-flow-stage','2');
      await page.locator('[data-flow-step="2"]').evaluate(e=>e.blur());
      await page.clock.runFor(1);
      await expect(workflow).toHaveAttribute('data-motion','running');
      const report=page.locator('.currency-report-demo');
      await report.scrollIntoViewIfNeeded();
      await expect(report).toHaveAttribute('data-motion','running');
      await page.clock.runFor(6000);
      await expect(report).toHaveAttribute('data-report-currency','MYR');
      await page.emulateMedia({reducedMotion:'reduce'});
      await expect(report).toHaveAttribute('data-motion','paused');
      await page.clock.runFor(12000);
      await expect(report).toHaveAttribute('data-report-currency','MYR');
      await page.locator('.currency-closing').scrollIntoViewIfNeeded();
      await expect(hero).toHaveAttribute('data-motion','paused');
      await expect(workflow).toHaveAttribute('data-motion','paused');
    });
  }
  test(`Currency ${locale} reduced motion`, async ({page}) => {
    await page.emulateMedia({reducedMotion:'reduce'});await page.goto(route);
    await expect(page.locator('.currency-hero-demo')).toHaveAttribute('data-motion','paused');
    await expect(page.locator('.currency-timeline-cursor')).toHaveCSS('display','none');
    await expect(page.locator('.currency-route-motion')).toHaveCSS('animation-name','none');
    await page.locator('[data-flow-step="1"]').click();
    await expect(page.locator('#currency-flow-1')).toBeVisible();
  });
  test(`Currency ${locale} no JavaScript`, async ({browser}) => {
    const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    try {
      const page=await context.newPage();await page.goto('http://127.0.0.1:8765'+route);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('.currency-flow-panel:visible')).toHaveCount(4);
      await expect(page.locator('.currency-report-window')).toBeVisible();
      await expect(page.locator('.currency-review-wide')).toBeVisible();
      await expect(page.locator('.currency-review-card')).toHaveCount(2);
      await expect(page.locator('[data-chart-actual]')).toHaveText('S$2,450.00');
      await expect(page.locator('.currency-reference-band')).toBeVisible();
      await page.locator('.currency-faq summary').first().click();
      await expect(page.locator('.currency-faq details p').first()).toBeVisible();
      await expect(page.locator('.footer-component')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
    } finally { await context.close(); }
  });
}
