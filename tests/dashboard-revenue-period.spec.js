// @ts-check
const { test, expect } = require('@playwright/test');

function attachConsoleErrors(page) {
    const errors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    return errors;
}

async function waitForRenderedRevenue(page) {
    await page.waitForFunction(() => {
        const value = document.getElementById('kpi-revenue')?.textContent || '';
        const count = document.getElementById('revenue-record-count')?.textContent || '';
        const comparison = document.getElementById('kpi-revenue-change')?.textContent || '';
        return !count.includes('Loading') && !comparison.includes('Loading') && value !== 'Unavailable';
    }, { timeout: 20000 });
}

async function waitForRevenue(page) {
    await page.addInitScript(() => {
        sessionStorage.setItem('fluxy_learning_promoter_skipped', '1');
    });
    await page.goto('/dashboard.html');
    await waitForRenderedRevenue(page);
}

async function dismissLearningPromoter(page) {
    const overlay = page.locator('#fluxy-learn-promoter-overlay');
    if (await overlay.count()) {
        await page.keyboard.press('Escape');
        await expect(overlay).toHaveCount(0);
    }
}

function parseIDR(value) {
    const digits = String(value || '').replace(/[^\d]/g, '');
    return Number(digits || 0);
}

test('Overview selector rescopes the dashboard and preserves Revenue context', async ({ page }) => {
    const consoleErrors = attachConsoleErrors(page);
    await waitForRevenue(page);

    await expect(page.locator('#overview-period-selector [data-dashboard-period]')).toHaveCount(5);
    await expect(page.locator('#overview-period-month')).toHaveClass(/is-active/);
    await expect(page.locator('#revenue-scope-label')).toHaveText('This month');
    await expect(page.locator('#revenue-secondary-label')).toHaveText('All-time revenue');

    const monthRevenue = parseIDR(await page.locator('#kpi-revenue').textContent());
    const allTimeRevenue = parseIDR(await page.locator('#revenue-secondary-value').textContent());
    const monthRange = await page.evaluate(() => window.FluxyDashboardRange);
    expect(allTimeRevenue).toBeGreaterThanOrEqual(monthRevenue);

    await dismissLearningPromoter(page);
    await page.locator('#overview-period-last-month').click();
    await waitForRenderedRevenue(page);
    await expect(page.locator('#overview-period-last-month')).toHaveClass(/is-active/);
    await expect(page.locator('#revenue-scope-label')).toHaveText('Last month');
    await expect(page.locator('#revenue-secondary-label')).toHaveText('All-time revenue');
    expect(await page.evaluate(() => window.FluxyDashboardRange)).not.toEqual(monthRange);

    await dismissLearningPromoter(page);
    await page.locator('#overview-period-ytd').click();
    await waitForRenderedRevenue(page);
    await expect(page.locator('#overview-period-ytd')).toHaveClass(/is-active/);
    await expect(page.locator('#revenue-scope-label')).toHaveText('Year to date');
    await expect(page.locator('#revenue-secondary-label')).toHaveText('All-time revenue');
    expect(parseIDR(await page.locator('#revenue-secondary-value').textContent())).toBe(allTimeRevenue);
    expect(parseIDR(await page.locator('#kpi-revenue').textContent())).toBeGreaterThanOrEqual(monthRevenue);

    await dismissLearningPromoter(page);
    await page.locator('#overview-period-custom').click();
    await waitForRenderedRevenue(page);
    await expect(page.locator('#overview-period-custom')).toHaveClass(/is-active/);
    await expect(page.locator('#dashboard-date-range-picker')).toBeVisible();
    await expect(page.locator('#revenue-secondary-label')).toHaveText('All-time revenue');

    await dismissLearningPromoter(page);
    await page.locator('#overview-period-all').click();
    await waitForRenderedRevenue(page);
    await expect(page.locator('#overview-period-all')).toHaveClass(/is-active/);
    await expect(page.locator('#revenue-scope-label')).toHaveText('All time');
    await expect(page.locator('#revenue-secondary-label')).toHaveText('This month');
    expect(parseIDR(await page.locator('#kpi-revenue').textContent())).toBe(allTimeRevenue);
    expect(parseIDR(await page.locator('#revenue-secondary-value').textContent())).toBe(monthRevenue);
    await expect(page.locator('#kpi-revenue-change')).toHaveText('No previous period data');

    const revenueCardText = await page.locator('[data-tour-target="dashboard-revenue-kpi"]').textContent();
    expect(revenueCardText).not.toMatch(/NaN|Infinity|undefined/i);
    await expect(page.locator('#kpi-opex, #kpi-margin, #kpi-bank-cash, #kpi-cash-pressure, #kpi-payables')).toHaveCount(5);
    expect(consoleErrors).toEqual([]);
});

test('Overview Revenue selector fits a 375px viewport', async ({ page }) => {
    const consoleErrors = attachConsoleErrors(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await waitForRevenue(page);

    const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
    await expect(page.locator('#overview-period-selector')).toBeVisible();
    await expect(page.locator('footer')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/dashboard-revenue-period/overview-mobile.png', fullPage: false });
    expect(consoleErrors).toEqual([]);
});

test('Overview desktop shell and Fluxy AI drawer remain intact', async ({ page }) => {
    const consoleErrors = attachConsoleErrors(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await waitForRevenue(page);

    await expect(page.locator('#sidebar')).toBeVisible();
    await expect(page.locator('footer')).toHaveCount(0);
    const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);

    await page.waitForFunction(() => typeof window.toggleFluxyAI === 'function' && !!document.getElementById('ai-chat-window'));
    await page.evaluate(() => window.toggleFluxyAI(true));
    await expect(page.locator('#ai-chat-window')).toHaveClass(/active/);
    await page.locator('#close-chat').click();
    await expect(page.locator('#ai-chat-window')).not.toHaveClass(/active/);
    await page.screenshot({ path: 'test-results/dashboard-revenue-period/overview-desktop.png', fullPage: false });
    expect(consoleErrors).toEqual([]);
});

test('Overview first KPI row keeps a compact vertical rhythm', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await waitForRevenue(page);
    // Bank snapshots render after the revenue KPI — wait for the sparkline
    // line before measuring, or the geometry reads race the async draw.
    await page.waitForSelector('#kpi-bank-cash-sparkline path[stroke="#22C55E"]', { timeout: 20000 });

    const spacing = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector)?.getBoundingClientRect();
        const bankTiles = rect('#kpi-bank-cash')?.width ? rect('#kpi-bank-cash') : null;
        const opexGrid = document.querySelector('#kpi-opex')?.closest('.metric-cell')?.querySelector('.metric-mini-grid')?.getBoundingClientRect();
        const opexSub = rect('#kpi-opex-change');
        const opexBar = document.querySelector('#kpi-opex-budget-bar')?.parentElement?.getBoundingClientRect();
        const revenueSecondary = document.querySelector('.metric-revenue-secondary')?.getBoundingClientRect();
        const revenueComparison = document.querySelector('.metric-comparison-row')?.getBoundingClientRect();
        const summaryBoard = document.querySelector('.summary-board');
        return {
            hasBankValue: !!bankTiles,
            hasBankSparkline: !!document.getElementById('kpi-bank-cash-sparkline'),
            bankSparklineHasGreenLine: !!document.querySelector('#kpi-bank-cash-sparkline path[stroke="#22C55E"]'),
            bankSparklineHasMarker: !!document.querySelector('#kpi-bank-cash-sparkline circle'),
            summaryColumns: summaryBoard ? getComputedStyle(summaryBoard).gridTemplateColumns.split(' ').length : 0,
            opexSubGap: opexSub && opexGrid ? opexSub.top - opexGrid.bottom : null,
            opexBarGap: opexBar && opexSub ? opexBar.top - opexSub.bottom : null,
            revenueLeftOffset: revenueSecondary && revenueComparison ? revenueComparison.left - revenueSecondary.left : null
        };
    });

    expect(spacing.hasBankValue).toBe(true);
    expect(spacing.hasBankSparkline).toBe(true);
    expect(spacing.bankSparklineHasGreenLine).toBe(true);
    expect(spacing.bankSparklineHasMarker).toBe(false);
    expect(spacing.summaryColumns).toBe(3);
    expect(spacing.opexSubGap).toBeLessThanOrEqual(20);
    expect(spacing.opexBarGap).toBeLessThanOrEqual(16);
    expect(spacing.revenueLeftOffset).toBeLessThanOrEqual(4);
    await page.screenshot({ path: 'test-results/dashboard-revenue-period/overview-kpi-wide.png', fullPage: false });
});

test('Overview Revenue read remains user-scoped and type allowlisted', async ({ page }) => {
    await page.goto('/assets/js/db-service.js');
    const source = await page.locator('body').textContent();
    // Finance reads must route through the workspace seam (PROJECT_BACKGROUND §4)
    // — hardcoded users/${userId}/ finance paths silently show members 0 data.
    expect(source).toContain('collection(this.db, `${this._scope(userId)}/transactions`)');
    expect(source).not.toContain('collection(this.db, `users/${userId}/transactions`)');
    expect(source).toContain("where('type', 'in', ['income', 'revenue', 'refund', 'pending_receivable'])");
    expect(source).not.toContain("where('type', 'in', ['income', 'revenue', 'refund', 'pending_receivable', 'expense'");
    expect(source).toContain('getTransactionsForDashboardOverview(userId, allTime = false)');
    expect(source).toContain('collection(this.db, `${this._scope(userId)}/bank_balance_snapshots`)');
    expect(source).toContain('balanceHistory: this._buildBankCashHistory(accounts, snapshots)');
    expect(source).toContain('at: snapshot.date.toISOString()');
    expect(source).not.toContain('const totalsByDay = new Map()');

    await page.goto('/assets/js/dashboard.js');
    const dashboardSource = await page.locator('body').textContent();
    expect(dashboardSource).toContain('if (bankSparklineValues.length === 1) bankSparklineValues.push(bankSparklineValues[0])');
});
