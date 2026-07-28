// @ts-check
const { test, expect } = require('@playwright/test');

// Layout regression for the Add Bill "Amount (Rp)" row. The currency <select> is
// auto-enhanced by fluxy-select.js into a full-width .fluxy-select wrapper, which
// previously hogged the flex row and collapsed the amount input to a sliver. The
// fix pins the currency dropdown to a fixed narrow width (.fluxy-amount-row CSS)
// and lets the amount input flex. Assert the amount input is the wide one.

test('Add Bill amount row: amount input flexes wide, currency dropdown stays narrow', async ({ page }) => {
    await page.goto('/bill.html');
    await page.waitForFunction(() => typeof window.showAddTransactionModal === 'function', null, { timeout: 30000 });

    await page.evaluate(() => window.showAddTransactionModal({ context: 'bill', title: 'Add New Bill', submitLabel: 'Save Bill', defaultCategory: 'Operations' }));
    await expect(page.locator('#tx-amount')).toBeVisible({ timeout: 15000 });
    // Wait for fluxy-select to enhance the currency select into its wrapper.
    await expect(page.locator('#tx-currency')).toBeAttached({ timeout: 15000 });
    await page.waitForFunction(() => {
        const sel = document.getElementById('tx-currency');
        return sel && sel.closest('.fluxy-select--enhanced');
    }, null, { timeout: 15000 });

    const m = await page.evaluate(() => {
        const amount = document.getElementById('tx-amount');
        const wrapper = document.getElementById('tx-currency').closest('.fluxy-select--enhanced');
        return {
            amountW: Math.round(amount.getBoundingClientRect().width),
            currencyW: Math.round(wrapper.getBoundingClientRect().width),
            sameRow: Math.abs(amount.getBoundingClientRect().top - wrapper.getBoundingClientRect().top) < 4
        };
    });

    // Currency dropdown is pinned narrow (~112px), never full-width.
    expect(m.currencyW).toBeLessThanOrEqual(140);
    // The amount input takes the rest of the row, comfortably wider than the picker.
    expect(m.amountW).toBeGreaterThan(m.currencyW * 2);
    // Both sit on the same row (the flex layout held).
    expect(m.sameRow).toBe(true);
});
