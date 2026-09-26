const { test, expect } = require('@playwright/test');
test.use({ storageState: { cookies: [], origins: [] } });

for (const locale of ['en', 'id']) {
  const prefix = locale === 'id' ? '/id' : '';
  for (const width of [390, 768, 1024, 1440]) {
    test(`Customers ${locale} at ${width}px`, async ({ page }) => {
      const errors = [];
      const missing = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (response.url().startsWith('http://127.0.0.1:8765/') && response.status() >= 400) missing.push(response.url());
      });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${prefix}/customers`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('.customer-hero h1')).toBeVisible();
      await expect(page.locator('.customer-preview')).toHaveCount(0);
      await expect(page.locator('.customer-stories-header > p')).toContainText(locale === 'id' ? 'Contoh cerita' : 'Illustrative stories');
      await expect(page.locator('.customer-logo-grid img')).toHaveCount(6);
      expect(await page.locator('.customer-logo-grid img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
      await expect(page.locator('.customer-story')).toHaveCount(6);
      await expect(page.locator('.customer-sample')).toHaveCount(0);
      await expect(page.locator('.customer-logo-grid')).not.toContainText(/Linear|Notion|Vercel|Shopify|GitHub|Figma/);
      await expect(page.locator('.customer-mosaic')).toBeAttached();
      expect(await page.locator('.customer-mosaic-tile').count()).toBeGreaterThan(200);
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
      await expect(page.locator('.footer-component')).toBeAttached();
      await expect(page.locator('.customer-closing a').first()).toHaveAttribute('href', `${prefix}/pricing`);
      await expect(page.locator('.customer-closing a').last()).toHaveAttribute('href', '/contact-sales');

      await page.locator('[data-customer-filter="retail"]').click();
      await expect(page.locator('.customer-story:visible')).toHaveCount(2);
      await expect(page.locator('[data-customer-count]')).toContainText('2');
      await page.locator('[data-customer-filter="finance"]').focus();
      await page.locator('[data-customer-filter="finance"]').press('Enter');
      await expect(page.locator('.customer-story:visible')).toHaveCount(1);
      await expect(page.locator('[data-customer-filter="finance"]')).toHaveAttribute('aria-pressed', 'true');
      await page.locator('[data-customer-filter="all"]').click();
      await expect(page.locator('.customer-story:visible')).toHaveCount(6);
      await page.locator('.customer-story summary').first().click();
      await expect(page.locator('.customer-story details blockquote').first()).toBeVisible();

      const schemas = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.map(node => JSON.parse(node.textContent)));
      expect(schemas.map(schema => schema['@type'])).toEqual(expect.arrayContaining(['Organization', 'SoftwareApplication', 'CollectionPage', 'BreadcrumbList']));
      expect(JSON.stringify(schemas)).not.toMatch(/aggregateRating|reviewBody|"@type":"Review"/);
      expect((await page.title()).length).toBeLessThanOrEqual(60);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://fluxyos.com${prefix}/customers`);
      if (width < 1024) {
        await page.locator('.mobile-menu-toggle').click();
        await expect(page.locator('#mobile-menu')).toBeVisible();
        await expect(page.locator(`#mobile-menu a[href="${prefix}/customers"]`)).toBeVisible();
        await page.locator('.mobile-menu-toggle').click();
        await expect(page.locator('#mobile-menu')).toBeHidden();
      }
      expect(missing).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
  test(`Customers ${locale} without JavaScript`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:8765${prefix}/customers`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.customer-story:visible')).toHaveCount(6);
    await expect(page.locator('[data-customer-filters]')).toBeHidden();
    await expect(page.locator('.customer-stories-header > p')).toBeVisible();
    await expect(page.locator('.customer-mosaic')).toBeVisible();
    await page.locator('.customer-story summary').first().click();
    await expect(page.locator('.customer-story blockquote').first()).toBeVisible();
    await context.close();
  });
  for (const width of [390, 1440]) {
    test(`Customers navbar entry ${locale} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(locale === 'id' ? '/id/fluxyos' : '/fluxyos', { waitUntil: 'domcontentloaded' });
      if (width < 1024) await page.locator('.mobile-menu-toggle').click();
      const scope = width < 1024 ? page.locator('#mobile-menu') : page.locator('nav');
      await scope.locator(`a[href="${prefix}/customers"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`${prefix}/customers$`));
      await expect(page.locator('.customer-hero h1')).toBeVisible();
    });
  }
}

test('reduced motion disables preview animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/customers', { waitUntil: 'domcontentloaded' });
  expect(await page.locator('.customer-meter span').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});
