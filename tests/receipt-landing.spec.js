const { test, expect } = require('@playwright/test');

for (const locale of ['en', 'id']) {
  const route = (locale === 'id' ? '/id' : '') + '/receiptcapture';
  const pricing = locale === 'id' ? '/id/pricing' : '/pricing';
  for (const width of [360, 390, 768, 1024, 1440]) {
    test(`Receipt ${locale} at ${width}px`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response.ok()).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('h1')).toBeInViewport();
      const hero = page.locator('.receipt-hero-stage');
      await hero.scrollIntoViewIfNeeded();
      await expect(hero).toBeVisible();
      await expect(hero).toHaveAttribute('data-motion', 'running');
      await expect(hero.locator('.receipt-scan-line')).toHaveCSS('animation-name', 'receipt-scan');
      const before = await hero.locator('.receipt-scan-line').evaluate(el => getComputedStyle(el).top);
      await page.waitForTimeout(600);
      const after = await hero.locator('.receipt-scan-line').evaluate(el => getComputedStyle(el).top);
      expect(after).not.toBe(before);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await expect(page.locator('.receipt-hero .receipt-primary')).toHaveAttribute('href', pricing);
      await expect(page.locator('.receipt-hero .receipt-button').nth(1)).toHaveAttribute('href', '/contact-sales');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://fluxyos.com' + route);
      await expect(page.locator('link[hreflang="en"]')).toHaveAttribute('href', 'https://fluxyos.com/receiptcapture');
      await expect(page.locator('link[hreflang="id"]')).toHaveAttribute('href', 'https://fluxyos.com/id/receiptcapture');

      const steps = page.locator('[data-receipt-step]');
      await steps.nth(2).focus();
      await page.keyboard.press('Enter');
      await expect(steps.nth(2)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('[data-receipt-stage]')).toHaveAttribute('data-receipt-stage', '2');
      await expect(page.locator('[data-receipt-caption]')).toHaveAttribute('aria-live', 'polite');
      await steps.nth(3).click();
      await expect(page.locator('[data-save-label]')).toHaveText(locale === 'id' ? 'Biaya tercatat' : 'Expense recorded');

      await page.locator('#receipt-demo-category').selectOption('Marketing');
      await expect(page.locator('[data-category-preview]')).toHaveText(locale === 'id' ? 'Pemasaran' : 'Marketing');
      await expect(page.locator('.receipt-journal tfoot .receipt-money')).toHaveText(['Rp277.500', 'Rp277.500']);
      expect((await page.locator('.receipt-journal caption').boundingBox()).width).toBeLessThanOrEqual(1);
      await page.locator('.receipt-accounting').scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

      const search = page.locator('#receipt-demo-search');
      await search.fill('Nusa');
      await expect(page.locator('[data-receipt-row]:visible')).toHaveCount(1);
      await expect(page.locator('[data-receipt-count]')).toHaveText('1');
      await search.fill('not-a-merchant');
      await expect(page.locator('[data-receipt-empty]')).toBeVisible();
      await expect(page.locator('[data-receipt-row]:visible')).toHaveCount(0);
      await search.fill('');
      await page.locator('[data-receipt-filter="missing"]').click();
      await expect(page.locator('[data-receipt-row]:visible')).toHaveCount(1);
      await page.locator('[data-receipt-filter="attached"]').focus();
      await page.keyboard.press('Space');
      await expect(page.locator('[data-receipt-row]:visible')).toHaveCount(3);

      const schemas = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.map(node => JSON.parse(node.textContent)));
      for (const type of ['Organization', 'SoftwareApplication', 'BreadcrumbList', 'FAQPage']) {
        expect(schemas.some(schema => schema['@type'] === type)).toBe(true);
      }
      const faqs = schemas.find(schema => schema['@type'] === 'FAQPage').mainEntity;
      await expect(page.locator('.receipt-faq details')).toHaveCount(faqs.length);
      for (let index = 0; index < faqs.length; index += 1) {
        const item = page.locator('.receipt-faq details').nth(index);
        await expect(item.locator('summary')).toHaveText(faqs[index].name);
        await expect(item.locator('p')).toHaveText(faqs[index].acceptedAnswer.text);
      }
      const footer = page.locator('.footer-component');
      await footer.scrollIntoViewIfNeeded();
      await expect(footer).toBeVisible();
      await expect(footer.locator(`a[href="${route}"]`)).toHaveText('Receipt Capture');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (width < 1024) {
        await page.locator('.mobile-menu-toggle').click();
        await expect(page.locator('#mobile-menu')).toBeVisible();
        await expect(page.locator(`#mobile-menu a[href="${route}"]`)).toBeVisible();
        await page.locator('.mobile-menu-toggle').click();
      }
      expect(errors).toEqual([]);
    });
  }

  for (const width of [390, 1440]) {
    test(`Receipt ${locale} auto motion at ${width}px`, async ({ page }) => {
      await page.clock.install();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      const hero = page.locator('.receipt-hero-stage');
      await hero.scrollIntoViewIfNeeded();
      await expect(hero).toHaveAttribute('data-motion', 'running');
      for (const phase of ['1', '2', '0']) {
        await page.clock.runFor(3000);
        await expect(hero).toHaveAttribute('data-hero-phase', phase);
      }
      const workflow = page.locator('.receipt-workflow');
      const visual = page.locator('[data-receipt-stage]');
      const steps = page.locator('[data-receipt-step]');
      await workflow.scrollIntoViewIfNeeded();
      await expect(workflow).toHaveAttribute('data-autoplay', 'running');
      for (const stage of ['1', '2', '3', '0']) {
        await page.clock.runFor(4200);
        await expect(visual).toHaveAttribute('data-receipt-stage', stage);
        await expect(steps.nth(Number(stage))).toHaveAttribute('aria-pressed', 'true');
      }
      await steps.nth(2).click();
      await expect(workflow).toHaveAttribute('data-autoplay', 'paused');
      await page.clock.runFor(8400);
      await expect(visual).toHaveAttribute('data-receipt-stage', '2');
      await steps.nth(2).evaluate(el => el.blur());
      await page.clock.runFor(1);
      await expect(workflow).toHaveAttribute('data-autoplay', 'running');
      await page.clock.runFor(4200);
      await expect(visual).toHaveAttribute('data-receipt-stage', '3');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(workflow).toHaveAttribute('data-autoplay', 'paused');
      await page.clock.runFor(8400);
      await expect(visual).toHaveAttribute('data-receipt-stage', '3');
      await page.locator('.receipt-closing').scrollIntoViewIfNeeded();
      await expect(workflow).toHaveAttribute('data-autoplay', 'paused');
      await expect(hero).toHaveAttribute('data-motion', 'paused');
    });
  }

  test(`Receipt ${locale} reduced motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(route);
    const hero = page.locator('.receipt-hero-stage');
    await hero.scrollIntoViewIfNeeded();
    await expect(hero).toHaveAttribute('data-motion', 'paused');
    await expect(hero.locator('.receipt-scan-line')).toHaveCSS('animation-name', 'none');
    await page.locator('[data-receipt-step="2"]').click();
    await expect(page.locator('[data-receipt-stage]')).toHaveAttribute('data-receipt-stage', '2');
    await expect(page.locator('.receipt-workflow')).toHaveAttribute('data-autoplay', 'paused');
  });

  test(`Receipt ${locale} without JavaScript`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:8765' + route);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('.receipt-step')).toHaveCount(4);
      await expect(page.locator('[data-receipt-row]')).toHaveCount(4);
      await expect(page.locator('.receipt-accounting')).toBeVisible();
      await page.locator('.receipt-faq details').first().locator('summary').click();
      await expect(page.locator('.receipt-faq details').first().locator('p')).toBeVisible();
      await expect(page.locator('.footer-component')).toBeVisible();
    } finally { await context.close(); }
  });
}
