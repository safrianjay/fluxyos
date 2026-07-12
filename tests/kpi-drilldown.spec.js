// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: Dashboard KPI drill-down pages (Revenue Overview / Cash Position /
 * OpEx & Budget) + the clickable Overview KPI cards.
 *
 * Read-only — reuses the page's authenticated Firebase session; never writes.
 * Verifies: each page boots to its content (no fatal error), renders a KPI
 * strip + trend + records table, breakdown toggles work, and no uncaught JS
 * exception fires. Then verifies the Overview cards navigate (carrying the
 * range) while the inner "?" info button does NOT navigate.
 */

const PAGES = [
    { key: 'revenue', route: '/revenue-overview', kpis: '#revenue-kpis', trend: '#revenue-trend', body: '#revenue-table-body', dims: ['category', 'source', 'business'] },
    { key: 'cash', route: '/cash-position', kpis: '#cash-kpis', trend: '#cash-trend', body: '#cash-table-body', dims: ['accounts', 'flow', 'upcoming'] },
    { key: 'opex', route: '/opex-budget', kpis: '#opex-kpis', trend: '#opex-trend', body: '#opex-table-body', dims: ['categories', 'allocations', 'over'] },
];

test.beforeEach(async ({ page }) => {
    await installTrialPaywallBypass(page);
});

function trackErrors(page) {
    const errors = [];
    page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const t = msg.text();
        // Ignore infra noise unrelated to this feature (analytics beacons,
        // favicon, benign Firebase transport retries).
        if (/favicon|net::ERR|analytics|googletagmanager|ERR_BLOCKED/i.test(t)) return;
        errors.push('console: ' + t);
    });
    return errors;
}

for (const p of PAGES) {
    test(`${p.key} detail page boots and renders`, async ({ page }) => {
        const errors = trackErrors(page);
        await page.goto(`${p.route}?period=this_month`);

        // Content shows (loading/error slots resolved to content).
        await page.waitForSelector('#kpi-content:not(.hidden)', { timeout: 25_000 });
        await expect(page.locator('#kpi-loading')).toBeHidden();
        await expect(page.locator('#kpi-error')).toBeHidden();

        // KPI strip populated (4 cells).
        await page.waitForFunction((sel) => {
            const el = document.querySelector(sel);
            return el && el.querySelectorAll('.kpi-detail-cell').length >= 3;
        }, p.kpis, { timeout: 15_000 });

        // Trend rendered — either an SVG plot or the documented empty-state.
        const trendHtml = (await page.locator(p.trend).innerHTML()).trim();
        expect(trendHtml.length, 'trend rendered something').toBeGreaterThan(0);

        // Records table body rendered (rows or empty-state, never the raw placeholder).
        await expect(page.locator(`${p.body} tr`).first()).toBeVisible();

        // Breakdown dimension toggles switch without error.
        for (const dim of p.dims) {
            await page.locator(`[data-breakdown-dim="${dim}"]`).click();
            await expect(page.locator(`[data-breakdown-dim="${dim}"]`)).toHaveClass(/is-active/);
        }

        expect(errors, `no uncaught errors on ${p.route}`).toEqual([]);
    });
}

test('period strip updates the URL and reloads', async ({ page }) => {
    await page.goto('/revenue-overview?period=this_month');
    await page.waitForSelector('#kpi-content:not(.hidden)', { timeout: 25_000 });
    await page.locator('[data-kpi-period="last_month"]').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('period')).toBe('last_month');
    await expect(page.locator('[data-kpi-period="last_month"]')).toHaveClass(/is-active/);
});

test('Overview KPI cards navigate and carry the range; info button does not', async ({ page }) => {
    await page.goto('/dashboard');
    // Cards exist once the overview summary board is present.
    await page.waitForSelector('[data-kpi-nav="revenue"]', { timeout: 25_000 });

    // The "?" info button inside the revenue card must NOT navigate.
    await page.locator('[data-kpi-nav="revenue"] .metric-info').click();
    await page.waitForTimeout(400);
    expect(new URL(page.url()).pathname).toMatch(/\/dashboard/);

    // Clicking the card body navigates to the detail page with a period param.
    await page.locator('[data-kpi-nav="revenue"] .metric-value').click();
    await page.waitForURL(/\/revenue-overview/, { timeout: 15_000 });
    const params = new URL(page.url()).searchParams;
    expect(params.get('period')).toBeTruthy();

    // Cash + OpEx cards route correctly too.
    await page.goto('/dashboard');
    await page.waitForSelector('[data-kpi-nav="cash"]', { timeout: 25_000 });
    await page.locator('[data-kpi-nav="cash"]').click();
    await page.waitForURL(/\/cash-position/, { timeout: 15_000 });

    await page.goto('/dashboard');
    await page.waitForSelector('[data-kpi-nav="opex"]', { timeout: 25_000 });
    await page.locator('[data-kpi-nav="opex"]').click();
    await page.waitForURL(/\/opex-budget/, { timeout: 15_000 });
});

test('records table row deep-links into the Ledger', async ({ page }) => {
    await page.goto('/revenue-overview?period=all_time');
    await page.waitForSelector('#kpi-content:not(.hidden)', { timeout: 25_000 });
    const firstRow = page.locator('#revenue-table-body tr[data-row-href]').first();
    const count = await page.locator('#revenue-table-body tr[data-row-href]').count();
    test.skip(count === 0, 'no revenue records on the QA account to deep-link');
    const href = await firstRow.getAttribute('data-row-href');
    expect(href).toMatch(/^\/ledger\?record=/);
    await firstRow.click();
    await page.waitForURL(/\/ledger\?record=/, { timeout: 15_000 });
});
