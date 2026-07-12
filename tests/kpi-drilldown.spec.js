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

        // Every KPI cell has a "?" info button with a tooltip.
        const cellCount = await page.locator(`${p.kpis} .kpi-detail-cell`).count();
        const infoCount = await page.locator(`${p.kpis} .metric-info[data-tooltip]`).count();
        expect(infoCount, 'a "?" info button on every KPI cell').toBe(cellCount);

        // Custom period reveals the date-range picker.
        const pickerHost = page.locator(`#${p.key === 'cash' ? 'cash' : p.key === 'opex' ? 'opex' : 'revenue'}-date-range-picker`);
        await page.locator('[data-kpi-period="custom"]').click();
        await expect(page.locator('[data-kpi-period="custom"]')).toHaveClass(/is-active/);
        await expect(pickerHost).toBeVisible();
        await expect.poll(() => new URL(page.url()).searchParams.get('period')).toBe('custom');

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

test('cash pressure page boots, horizon + breakdown toggles work', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/cash-pressure');
    await page.waitForSelector('#kpi-content:not(.hidden)', { timeout: 25_000 });
    await expect(page.locator('#pressure-kpis .kpi-detail-cell')).toHaveCount(4);
    // Every KPI has a "?" tooltip.
    expect(await page.locator('#pressure-kpis .metric-info[data-tooltip]').count()).toBe(4);
    // Horizon toggle.
    await page.locator('[data-kpi-horizon="90"]').click();
    await expect(page.locator('[data-kpi-horizon="90"]')).toHaveClass(/is-active/);
    await expect(page.locator('#pressure-horizon-label')).toHaveText(/90/);
    // Breakdown dims.
    for (const dim of ['payables', 'receivables', 'timing']) {
        await page.locator(`[data-breakdown-dim="${dim}"]`).click();
        await expect(page.locator(`[data-breakdown-dim="${dim}"]`)).toHaveClass(/is-active/);
    }
    await expect(page.locator('#pressure-table-body tr').first()).toBeVisible();
    expect(errors, 'no uncaught errors on /cash-pressure').toEqual([]);
});

test('All Time trend thins x-axis labels (no overlap smear)', async ({ page }) => {
    await page.goto('/revenue-overview?period=all_time');
    await page.waitForSelector('#kpi-content:not(.hidden)', { timeout: 25_000 });
    // The trend must render an SVG and show at most ~11 non-empty axis labels
    // even across many quarters (thinning) — the reported All-Time overlap bug.
    await expect(page.locator('#revenue-trend svg')).toBeVisible();
    const shownLabels = await page.locator('#revenue-trend >> css=span.truncate').evaluateAll(
        (spans) => spans.filter((s) => (s.textContent || '').trim().length > 0).length
    );
    expect(shownLabels).toBeLessThanOrEqual(11);
});

test('Overview margin/pressure/payables cards route correctly', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForSelector('[data-kpi-nav="margin"]', { timeout: 25_000 });
    await page.locator('[data-kpi-nav="margin"] .metric-value').click();
    await page.waitForURL(/\/revenue-overview/, { timeout: 15_000 });

    await page.goto('/dashboard');
    await page.waitForSelector('[data-kpi-nav="pressure"]', { timeout: 25_000 });
    await page.locator('[data-kpi-nav="pressure"]').click();
    await page.waitForURL(/\/cash-pressure/, { timeout: 15_000 });

    await page.goto('/dashboard');
    await page.waitForSelector('[data-kpi-nav="payables"]', { timeout: 25_000 });
    await page.locator('[data-kpi-nav="payables"]').click();
    await page.waitForURL(/\/bill/, { timeout: 15_000 });
});

test('dashboard Upcoming rows deep-link to the record', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForSelector('#upcoming-obligations-content .rail-mini-card, #upcoming-obligations-content .overview-empty-copy', { timeout: 25_000 });
    const cards = page.locator('#upcoming-obligations-content .rail-mini-card');
    const n = await cards.count();
    test.skip(n === 0, 'no upcoming obligations on the QA account');
    const href = await cards.first().getAttribute('href');
    expect(href).toMatch(/^\/(bill|subscription)\?record=/);
    await cards.first().click();
    await page.waitForURL(/\/(bill|subscription)\?record=/, { timeout: 15_000 });
});

test('dashboard Upcoming excludes paid/voided bills', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForSelector('#upcoming-obligations-content .rail-mini-card, #upcoming-obligations-content .overview-empty-copy', { timeout: 25_000 });

    // Paid/voided bill ids straight from Firestore (same scope db-service uses).
    const paidBillIds = await page.evaluate(async () => {
        const appMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const authMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const app = appMod.getApps()[0];
        const user = authMod.getAuth(app).currentUser;
        if (!app || !user) return [];
        const wsId = window.FLUXY_WORKSPACE_MODE && window.FluxyWorkspace && window.FluxyWorkspace.id;
        const scope = wsId ? `workspaces/${wsId}` : `users/${user.uid}`;
        const db = fsMod.getFirestore(app);
        const snap = await fsMod.getDocs(fsMod.collection(db, `${scope}/bills`));
        const paid = [];
        snap.forEach(d => { const b = d.data(); if (String(b.payment_status || '').toLowerCase() === 'paid' || b.is_voided) paid.push(d.id); });
        return paid;
    });

    const hrefs = await page.locator('#upcoming-obligations-content .rail-mini-card').evaluateAll(
        (els) => els.map((e) => e.getAttribute('href') || '')
    );
    const shownBillIds = hrefs
        .map((h) => { const m = /\/bill\?record=([^&]+)/.exec(h); return m ? decodeURIComponent(m[1]) : null; })
        .filter(Boolean);

    for (const id of shownBillIds) {
        expect(paidBillIds, `paid/voided bill ${id} must not appear in Upcoming`).not.toContain(id);
    }
});

test('detail pages resolve the workspace before finance reads (member-safety)', async ({ page }) => {
    // The member "sees 0 data" bug happens when a page reads finance data before
    // the workspace is resolved (_scope falls back to workspaces/{memberUid}).
    // Every drill-down must have workspace mode on + a resolved workspace id by
    // the time it renders content.
    for (const route of ['/revenue-overview', '/cash-position', '/cash-pressure', '/opex-budget']) {
        await page.goto(route);
        await page.waitForSelector('#kpi-content:not(.hidden)', { timeout: 25_000 });
        const scope = await page.evaluate(() => ({
            mode: window.FLUXY_WORKSPACE_MODE === true,
            id: (window.FluxyWorkspace && window.FluxyWorkspace.id) || null,
        }));
        expect(scope.mode, `${route}: workspace mode on`).toBeTruthy();
        expect(typeof scope.id === 'string' && scope.id.length > 0, `${route}: workspace resolved before read`).toBeTruthy();
    }
});

test('detail pages have no page-level horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    for (const route of ['/revenue-overview', '/cash-position', '/cash-pressure', '/opex-budget']) {
        await page.goto(route);
        await page.waitForSelector('#kpi-content:not(.hidden)', { timeout: 25_000 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${route} must not overflow horizontally at 375px`).toBeLessThanOrEqual(1);
    }
});

test('invoices ?record= opens the invoice detail', async ({ page }) => {
    await page.goto('/invoices');
    await page.waitForSelector('#invoice-list-view, #invoice-detail-view', { timeout: 25_000 });
    const invoiceId = await page.evaluate(async () => {
        const appMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const authMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const app = appMod.getApps()[0];
        const user = authMod.getAuth(app).currentUser;
        if (!app || !user) return null;
        const wsId = window.FLUXY_WORKSPACE_MODE && window.FluxyWorkspace && window.FluxyWorkspace.id;
        const scope = wsId ? `workspaces/${wsId}` : `users/${user.uid}`;
        const db = fsMod.getFirestore(app);
        const snap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, `${scope}/invoices`), fsMod.limit(1)));
        let id = null; snap.forEach(d => { id = d.id; });
        return id;
    });
    test.skip(!invoiceId, 'no invoices on the QA account to deep-link');
    await page.goto(`/invoices?record=${encodeURIComponent(invoiceId)}`);
    await expect(page.locator('#invoice-detail-view')).toBeVisible({ timeout: 15_000 });
});

test('detail "Back to Overview" preserves the period round-trip', async ({ page }) => {
    await page.goto('/revenue-overview?period=last_month');
    await page.waitForSelector('#kpi-content:not(.hidden)', { timeout: 25_000 });
    // Back links carry the range.
    const href = await page.locator('[data-dashboard-back]').first().getAttribute('href');
    expect(href).toMatch(/\/dashboard\?period=last_month/);
    // Round-trip: clicking Back reopens the dashboard on Last Month, not This Month.
    await page.locator('[data-dashboard-back]').first().click();
    await page.waitForURL(/\/dashboard\?period=last_month/, { timeout: 15_000 });
    await expect(page.locator('[data-dashboard-period="last_month"]')).toHaveClass(/is-active/);
});

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
