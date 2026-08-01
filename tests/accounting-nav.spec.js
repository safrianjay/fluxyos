// @ts-check
const { test, expect } = require('@playwright/test');
const { openAccountingTab, GROUP_OF_TAB } = require('./helpers/accounting-nav');

// Guards the Accounting Center two-level section nav (docs/ACCOUNTING_CENTER_IA.md):
// every view reachable, groups mutually exclusive, views deep-linkable, and the
// nav scrollable at 375px without the page scrolling horizontally.

const GROUPS = ['overview', 'reports', 'ledger', 'setup', 'close'];

test('every view is reachable and its panel is the only one visible', async ({ page }) => {
    const bad = [];
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/permission-denied|Missing or insufficient|CSP|Content Security|404|accounting/i.test(t)) bad.push(t);
    });
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));

    await page.goto('/accounting.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });

    // Overview is the default landing — founders get "are my books OK?" before a
    // statement they would have to interpret.
    await expect(page.locator('[data-acct-group="overview"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-acct-panel="overview"]')).toBeVisible();

    for (const tab of Object.keys(GROUP_OF_TAB)) {
        await openAccountingTab(page, tab);
        // Exactly one panel visible, and it is this one.
        await expect(page.locator('[data-acct-panel]:visible')).toHaveCount(1);
        await expect(page.locator(`[data-acct-panel="${tab}"]`)).toBeVisible();
        // The owning group is the only active one.
        await expect(page.locator('[data-acct-group].is-active')).toHaveCount(1);
        await expect(page.locator(`[data-acct-group="${GROUP_OF_TAB[tab]}"]`)).toHaveClass(/is-active/);
    }

    expect(bad, `console/page errors:\n${bad.join('\n')}`).toEqual([]);
});

test('child row shows only the active group, and groups remember their last view', async ({ page }) => {
    await page.goto('/accounting.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });

    // Single-view groups hide the child row entirely (it would hold one button).
    const EXPECTED_VIEWS = { overview: 0, reports: 4, ledger: 3, setup: 3, close: 2 };
    for (const group of GROUPS) {
        await page.locator(`[data-acct-group="${group}"]`).click();
        const visible = page.locator('[data-acct-tab]:visible');
        await expect(visible).toHaveCount(EXPECTED_VIEWS[group]);
        // Every visible child belongs to this group; none from another group leak in.
        for (const el of await visible.all()) {
            expect(await el.getAttribute('data-acct-parent')).toBe(group);
        }
    }

    // Land on Trial Balance, leave the group, come back — it should return there
    // rather than resetting to the group's first view.
    await openAccountingTab(page, 'trial');
    await page.locator('[data-acct-group="setup"]').click();
    await page.locator('[data-acct-group="ledger"]').click();
    await expect(page.locator('[data-acct-panel="trial"]')).toBeVisible();
});

// statements-engine returns margins as fractions; the KPI strip must render them
// as percentages. A missing ×100 shows "1% gross margin" for a ~100% margin.
test('KPI strip margins are percentages and tie to the Income Statement', async ({ page }) => {
    await page.goto('/accounting.html');
    await page.waitForSelector('#accounting-content:not(.hidden)', { timeout: 60000 });

    await openAccountingTab(page, 'income');
    const figures = await page.evaluate(() => ({
        revenue: document.getElementById('kpi-revenue-value').textContent.trim(),
        gross: document.getElementById('kpi-gross-value').textContent.trim(),
        grossSub: document.getElementById('kpi-gross-sub').textContent.trim(),
        netSub: document.getElementById('kpi-net-sub').textContent.trim(),
        table: document.getElementById('income-statement-content').innerText
    }));

    // Margin subtitles read "<n>% gross margin" or "N/A gross margin" — never a
    // bare fraction rounded to 0% / 1%.
    expect(figures.grossSub).toMatch(/^(N\/A|-?\d+(\.\d)?%) gross margin$/);
    expect(figures.netSub).toMatch(/^(N\/A|-?\d+(\.\d)?%) net margin$/);

    // The strip must agree with the statement it sits above.
    if (figures.table.includes('Total revenue')) {
        const row = figures.table.split('\n').find(l => l.startsWith('Total revenue'));
        expect(row, 'Total revenue row').toBeTruthy();
        expect(row).toContain(figures.revenue);
    }
});

test('views are deep-linkable via ?tab= and the URL tracks navigation', async ({ page }) => {
    await page.goto('/accounting.html?tab=trial');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-acct-panel="trial"]')).toBeVisible();
    await expect(page.locator('[data-acct-group="ledger"]')).toHaveClass(/is-active/);

    // Navigating updates the URL so the current view can be shared.
    await openAccountingTab(page, 'coa');
    await expect(page).toHaveURL(/[?&]tab=coa/);

    // An unknown tab falls back to the default view instead of a blank page.
    await page.goto('/accounting.html?tab=does-not-exist');
    await expect(page.locator('[data-acct-panel="overview"]')).toBeVisible({ timeout: 30000 });
});

test('nav scrolls internally at 375px without the page scrolling horizontally', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/accounting.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });

    for (const group of GROUPS) {
        await page.locator(`[data-acct-group="${group}"]`).click();
        const overflow = await page.evaluate(() =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `page scrolls horizontally on group "${group}"`).toBeLessThanOrEqual(1);
    }

    // Both rows absorb their own overflow.
    for (const sel of ['.acct-tabs', '.acct-subtabs']) {
        const scrollable = await page.locator(sel).evaluate((n) =>
            getComputedStyle(n).overflowX === 'auto' || getComputedStyle(n).overflowX === 'scroll');
        expect(scrollable, `${sel} must scroll internally`).toBe(true);
    }
});
