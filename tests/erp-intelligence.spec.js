const { test, expect } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });

for (const locale of ['en', 'id']) {
  for (const width of [390, 768, 1024, 1280, 1440]) {
    test(`ERP Intelligence ${locale} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(locale === 'id' ? '/id/erp-intelligence' : '/erp-intelligence');
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('main h1')).toContainText(locale === 'id' ? 'Lihat angkanya.' : 'Finance data');
      await expect(page.locator('.erp-hero-card')).toHaveCount(5);
      await expect(page.locator('.footer-component')).toBeAttached();
      await expect(page.locator(`.erp-hero a[href="${locale === 'id' ? '/id/pricing' : '/pricing'}"]`)).toContainText(locale === 'id' ? 'Mulai gratis' : 'Start free');
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
      await page.locator('.erp-ledger-details summary').click();
      await expect(page.locator('.erp-ledger-entry')).toBeVisible();
      await page.locator('.erp-expense-details summary').click();
      await expect(page.locator('.erp-expense-details')).toContainText('Rp180.000');

      await page.locator('#statement-tab-balance').click();
      await expect(page.locator('#statement-balance')).toBeVisible();
      await expect(page.locator('#statement-income')).toBeHidden();
      await page.locator('#statement-tab-balance').press('ArrowRight');
      await expect(page.locator('#statement-tab-cashflow')).toBeFocused();
      await expect(page.locator('#statement-cashflow')).toBeVisible();
      await page.locator('#statement-tab-cashflow').press('Home');
      await expect(page.locator('#statement-income')).toBeVisible();

      const faq = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.map(node => JSON.parse(node.textContent)).find(node => node['@type'] === 'FAQPage'));
      const visibleFaq = page.locator('.erp-faq-list details');
      await expect(visibleFaq).toHaveCount(faq.mainEntity.length);
      for (let i = 0; i < faq.mainEntity.length; i++) {
        await expect(visibleFaq.nth(i).locator('p')).toHaveText(faq.mainEntity[i].acceptedAnswer.text);
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
}

test('ERP Intelligence is readable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8765/id/erp-intelligence');
  await expect(page.locator('h1')).toContainText('Lihat angkanya.');
  await expect(page.locator('#statement-income')).toBeVisible();
  await page.locator('.erp-faq-list summary').first().click();
  await expect(page.locator('.erp-faq-list details').first().locator('p')).toBeVisible();
  await context.close();
});

for (const locale of ['en', 'id']) {
  for (const width of [390, 1440]) {
    test(`Platform menu opens ERP Intelligence: ${locale}, ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(locale === 'id' ? '/id/fluxyos' : '/fluxyos');
      const route = locale === 'id' ? '/id/erp-intelligence' : '/erp-intelligence';
      if (width < 1024) {
        await page.locator('.mobile-menu-toggle').click();
        await page.locator(`#mobile-menu a[href="${route}"]`).click();
      } else {
        await page.locator('nav').getByRole('button', { name: 'Platform', exact: true }).hover();
        await page.locator(`nav a[href="${route}"]`).filter({ hasText: 'ERP Intelligence' }).first().click();
      }
      await expect(page).toHaveURL(new RegExp(route + '$'));
      await expect(page.locator('main h1')).toBeVisible();
    });
  }
}
