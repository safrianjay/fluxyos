// @ts-check
const { test, expect } = require('@playwright/test');

// The Add Bill modal exposes an optional "PPN rate (%)" field (bill context only),
// which feeds tax_rate_percent on the bill so it posts input PPN. Confirms the field
// renders + accepts input in bill context and is absent in transaction context (no
// regression to the shared Add Transaction modal). End-to-end posting is covered by
// tax-bill-ppn.spec.js.

test('Add Bill modal shows a PPN rate field; Add Transaction modal does not', async ({ page }) => {
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error' && /tax|ppn|modal|bill/i.test(m.text())) errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

    await page.goto('/bill.html');
    await page.waitForFunction(() => typeof window.showAddTransactionModal === 'function', null, { timeout: 30000 });

    // Bill context → PPN field present + editable.
    await page.evaluate(() => window.showAddTransactionModal({ context: 'bill', title: 'Add New Bill', submitLabel: 'Save Bill', defaultCategory: 'Operations' }));
    await expect(page.locator('#tx-amount')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#tx-bill-tax-rate')).toBeVisible();
    await page.fill('#tx-bill-tax-rate', '11');
    await expect(page.locator('#tx-bill-tax-rate')).toHaveValue('11');

    // Transaction context → PPN field absent.
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.showAddTransactionModal({ context: 'transaction' }));
    await expect(page.locator('#tx-amount')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#tx-bill-tax-rate')).toHaveCount(0);

    expect(errs, `console/page errors:\n${errs.join('\n')}`).toEqual([]);
});
