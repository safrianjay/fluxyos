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
    await page.goto('/dashboard.html');
    await waitForRenderedRevenue(page);
}

function parseIDR(value) {
    const digits = String(value || '').replace(/[^\d]/g, '');
    return Number(digits || 0);
}

test('Overview Revenue selector changes only Revenue context', async ({ page }) => {
    const consoleErrors = attachConsoleErrors(page);
    await waitForRevenue(page);

    await expect(page.locator('#overview-period-selector [data-revenue-period]')).toHaveCount(3);
    await expect(page.locator('#overview-period-month')).toHaveClass(/is-active/);
    await expect(page.locator('#revenue-scope-label')).toHaveText('This month');
    await expect(page.locator('#revenue-secondary-label')).toHaveText('All-time revenue');

    const monthRevenue = parseIDR(await page.locator('#kpi-revenue').textContent());
    const allTimeRevenue = parseIDR(await page.locator('#revenue-secondary-value').textContent());
    const stableKpis = await page.locator('#kpi-opex, #kpi-margin, #kpi-bank-cash, #kpi-cash-pressure, #kpi-payables').allTextContents();
    expect(allTimeRevenue).toBeGreaterThanOrEqual(monthRevenue);

    await page.locator('#overview-period-ytd').click();
    await expect(page.locator('#overview-period-ytd')).toHaveClass(/is-active/);
    await expect(page.locator('#revenue-scope-label')).toHaveText('Year to date');
    await expect(page.locator('#revenue-secondary-label')).toHaveText('All-time revenue');
    expect(parseIDR(await page.locator('#revenue-secondary-value').textContent())).toBe(allTimeRevenue);
    expect(parseIDR(await page.locator('#kpi-revenue').textContent())).toBeGreaterThanOrEqual(monthRevenue);

    await page.locator('#overview-period-all').click();
    await expect(page.locator('#overview-period-all')).toHaveClass(/is-active/);
    await expect(page.locator('#revenue-scope-label')).toHaveText('All time');
    await expect(page.locator('#revenue-secondary-label')).toHaveText('This month');
    expect(parseIDR(await page.locator('#kpi-revenue').textContent())).toBe(allTimeRevenue);
    expect(parseIDR(await page.locator('#revenue-secondary-value').textContent())).toBe(monthRevenue);
    await expect(page.locator('#kpi-revenue-change')).toHaveText('No previous period data');

    const revenueCardText = await page.locator('[data-tour-target="dashboard-revenue-kpi"]').textContent();
    expect(revenueCardText).not.toMatch(/NaN|Infinity|undefined/i);
    expect(await page.locator('#kpi-opex, #kpi-margin, #kpi-bank-cash, #kpi-cash-pressure, #kpi-payables').allTextContents()).toEqual(stableKpis);
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

test('Overview Revenue read remains user-scoped and type allowlisted', async ({ page }) => {
    await page.goto('/assets/js/db-service.js');
    const source = await page.locator('body').textContent();
    expect(source).toContain('collection(this.db, `users/${userId}/transactions`)');
    expect(source).toContain("where('type', 'in', ['income', 'revenue', 'refund', 'pending_receivable'])");
    expect(source).not.toContain("where('type', 'in', ['income', 'revenue', 'refund', 'pending_receivable', 'expense'");
});
