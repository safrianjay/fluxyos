// @ts-check
const { test, expect } = require('@playwright/test');

async function suppressPaywall(page) {
    await page.addStyleTag({
        content: '[data-fluxy-paywall]{display:none!important;pointer-events:none!important;}'
    }).catch(() => {});
}

test('budget main page shows the annual planning hierarchy', async ({ page }) => {
    await page.goto('/budget.html');
    await suppressPaywall(page);
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 15000 });

    await expect(page.locator('#budget-main-select')).toBeAttached();
    await expect(page.locator('#budget-annual-total')).toContainText(/Rp/);
    await expect(page.locator('#budget-spent-reserved')).toContainText(/Rp/);
    await expect(page.locator('#budget-not-planned')).toContainText(/Rp/);
    await expect(page.locator('#budget-planned-bar')).toBeVisible();
    await expect(page.locator('#budget-period-body')).not.toContainText(/Allocation/i);

    await page.screenshot({ path: 'test-results/budget-verify/TOOLTIP-budget.png', fullPage: false });
});

test('overview KPI tooltips still work after shared extraction', async ({ page }) => {
    await page.goto('/dashboard.html');
    // The overview KPI buttons exist in the static markup, no async wait needed
    // beyond making sure the page has rendered.
    await page.waitForSelector('.metric-info[data-tooltip]', { timeout: 15000 });
    const overviewButtons = page.locator('.metric-info[data-tooltip]');
    const count = await overviewButtons.count();
    expect(count).toBeGreaterThan(0);

    const first = overviewButtons.first();
    await first.hover();
    await page.waitForFunction(() => {
        const t = document.querySelector('.metric-tooltip');
        return t && t.classList.contains('is-visible');
    }, { timeout: 3000 });
    const tip = await page.locator('.metric-tooltip').textContent();
    console.log(`[overview first tooltip] ${tip}`);
    expect(tip?.length || 0).toBeGreaterThan(10);
});
