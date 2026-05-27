// @ts-check
const { test, expect } = require('@playwright/test');

test('budget KPI tooltips: 5 cards, hover surfaces the right copy', async ({ page }) => {
    await page.goto('/budget.html');
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 15000 });

    // Each KPI card must carry a metric-info button (5 total).
    const buttons = page.locator('#budget-content .metric-info[data-tooltip]');
    await expect(buttons).toHaveCount(5);

    // Hover each one in turn and read the shared .metric-tooltip text.
    const expectedKeywords = [
        ['Main Budget',      /amount you can spend during this period/i],
        ['Allocated',        /split into category allocations/i],
        ['Spent \\+ Reserved', /reduce what is remaining/i],
        ['Remaining',        /Budget left after recorded spend/i],
        ['EOY Forecast',     /current plan baseline/i]
    ];
    for (let i = 0; i < expectedKeywords.length; i++) {
        const [label, expectedCopy] = expectedKeywords[i];
        const btn = buttons.nth(i);
        const aria = await btn.getAttribute('aria-label');
        console.log(`[card ${i}] aria=${aria}`);
        await btn.hover();
        // Wait for the shared tooltip element to enter is-visible state.
        await page.waitForFunction(() => {
            const t = document.querySelector('.metric-tooltip');
            return t && t.classList.contains('is-visible');
        }, { timeout: 3000 });
        const tooltipText = await page.locator('.metric-tooltip').textContent();
        console.log(`[card ${i}] tooltip="${tooltipText}"`);
        expect(tooltipText).toMatch(expectedCopy);
        // Move the mouse off so the next hover triggers cleanly.
        await page.mouse.move(0, 0);
        await page.waitForTimeout(120);
    }

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
