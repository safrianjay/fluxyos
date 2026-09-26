const { test, expect } = require('@playwright/test');
test.use({ storageState: { cookies: [], origins: [] } });

for (const slug of ['budgetlanding', 'revenuesync']) {
  for (const locale of ['en', 'id']) {
    for (const width of [390, 768, 1024, 1440]) {
      test(`${slug} ${locale} at ${width}px`, async ({ page }) => {
        const prefix = locale === 'id' ? '/id' : '';
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`${prefix}/${slug}`);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.locator('main h1')).toBeVisible();
        await expect(page.locator('.fl-window')).toBeVisible();
        await expect(page.locator('.footer-component')).toBeAttached();
        await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
        await expect(page.locator('.fl-hero a').first()).toHaveAttribute('href', `${prefix}/pricing`);
        await expect(page.locator('.fl-closing a').last()).toHaveAttribute('href', '/contact-sales');
        const schema = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes =>
          nodes.map(node => JSON.parse(node.textContent)).find(data => data['@type'] === 'FAQPage'));
        const details = page.locator('.fl-faq details');
        await expect(details).toHaveCount(schema.mainEntity.length);
        for (let i = 0; i < schema.mainEntity.length; i++) {
          const question = await details.nth(i).locator('summary').innerText();
          expect(question.replace(/\s*\+$/, '').trim()).toBe(schema.mainEntity[i].name);
          await expect(details.nth(i).locator('p')).toHaveText(schema.mainEntity[i].acceptedAnswer.text);
        }
        await details.first().locator('summary').click();
        await expect(details.first().locator('p')).toBeVisible();
        if (slug === 'revenuesync') {
          await page.locator('#tab-orders').press('ArrowRight');
          await expect(page.locator('#tab-refunds')).toBeFocused();
          await expect(page.locator('#panel-refunds')).toBeVisible();
          await expect(page.locator('#panel-orders')).toBeHidden();
          await page.locator('#tab-refunds').press('End');
          await expect(page.locator('#panel-settlements')).toBeVisible();
          await page.locator('#tab-settlements').press('Home');
          await expect(page.locator('#panel-orders')).toBeVisible();
        }
        if (width < 1024) {
          await page.locator('.mobile-menu-toggle').click();
          await expect(page.locator('#mobile-menu')).toBeVisible();
          await page.locator('.mobile-menu-toggle').click();
          await expect(page.locator('#mobile-menu')).toBeHidden();
        }
        expect(errors).toEqual([]);
      });
    }
    test(`${slug} ${locale} without JavaScript`, async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:8765/${locale === 'id' ? 'id/' : ''}${slug}`);
      await expect(page.locator('main h1')).toBeVisible();
      if (slug === 'revenuesync') {
        for (const id of ['orders', 'refunds', 'settlements']) await expect(page.locator(`#panel-${id}`)).toBeVisible();
      }
      await page.locator('.fl-faq summary').first().click();
      await expect(page.locator('.fl-faq details p').first()).toBeVisible();
      await context.close();
    });
  }
}

test('motion accents respect reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/revenuesync');
  expect(await page.locator('.fl-source-strip i').first().evaluate(el =>
    getComputedStyle(el, '::after').animationName)).toBe('none');
});
