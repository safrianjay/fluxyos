// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Phase 2 verify spec. Drives the actual UI against the live fluxyos project.
 *
 * Probes:
 *   P1 — allocation row opens the Phase C full-page drill-in
 *   P2 — Phase 2 sections render on /budget-period (unallocated, excluded, activity)
 *   P3 — ledger row shows a budget chip
 *   P4 — bills row shows a budget chip
 *   P5 — shared FluxyBudgetAssignment is exposed on every app page
 *   P6 — calculation invariant: getBudgetUsage doesn't double-count records
 */

const SHOTS = 'test-results/budget-verify/phase2';

function attachLog(page, log) {
    page.on('console', m => {
        if (['error', 'warning', 'pageerror'].includes(m.type())) log.push({ t: m.type(), text: m.text() });
    });
    page.on('pageerror', e => log.push({ t: 'pageerror', text: e.message }));
}

async function suppressPaywall(page) {
    await page.addStyleTag({
        content: '[data-fluxy-paywall]{display:none!important;pointer-events:none!important;}'
    }).catch(() => {});
}

async function openFirstPeriodDetail(page) {
    await page.goto('/budget.html');
    await suppressPaywall(page);
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 15000 });
    const firstPeriod = page.locator('#budget-period-body tr[data-action="open-period-detail"]').first();
    await expect(firstPeriod).toBeVisible();
    const periodId = await firstPeriod.getAttribute('data-period-id');
    await firstPeriod.click();
    await expect(page).toHaveURL(new RegExp(`/budget-period/${periodId}$`));
    await suppressPaywall(page);
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 15000 });
}

test('P1: allocation row opens the full-page allocation drill-in', async ({ page }) => {
    const log = [];
    attachLog(page, log);
    await openFirstPeriodDetail(page);
    // First allocation row (variance text means we need to wait for render)
    const firstRow = page.locator('#budget-alloc-body tr[data-action="open-allocation-drill-in"]').first();
    await expect(firstRow).toBeVisible();
    const allocationId = await firstRow.getAttribute('data-allocation-id');
    await firstRow.click();
    await expect(page).toHaveURL(new RegExp(`/budget-allocation/${allocationId}$`));
    await expect(page.locator('#budget-detail-drawer')).toHaveCount(0);
    await page.waitForFunction(() => {
        const c = document.getElementById('allocation-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 10000 });
    const heading = await page.locator('#allocation-title').textContent();
    console.log('[P1] drill-in for allocation:', heading?.trim());
    await page.screenshot({ path: `${SHOTS}/P1-allocation-drill-in.png`, fullPage: true });
    await expect(page.locator('#allocation-content')).toContainText(/Spending groups/i);
    await expect(page.locator('#allocation-record-title')).toContainText(/Related Records/i);
    await expect(page.locator('#allocation-back-link')).toBeVisible();
});

test('P1b: allocation stacked-bar segment opens the full-page drill-in', async ({ page }) => {
    await openFirstPeriodDetail(page);
    const firstSegment = page.locator('#budget-allocation-bar [data-action="open-allocation-drill-in"]').first();
    await expect(firstSegment).toBeVisible();
    const allocationId = await firstSegment.getAttribute('data-allocation-id');
    await firstSegment.click();
    await expect(page).toHaveURL(new RegExp(`/budget-allocation/${allocationId}$`));
    await page.waitForFunction(() => {
        const c = document.getElementById('allocation-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 10000 });
    await expect(page.locator('#allocation-record-title')).toContainText(/Related Records/i);
});

test('P2: Phase 2 sections present (unallocated / excluded / activity) when applicable', async ({ page }) => {
    const log = [];
    attachLog(page, log);
    await openFirstPeriodDetail(page);
    await page.waitForTimeout(1200);
    const presentSections = await page.evaluate(() => {
        return {
            excluded: !document.getElementById('budget-excluded-card')?.classList.contains('hidden'),
            recentActivity: !!document.getElementById('budget-recent-activity-list')
        };
    });
    console.log('[P2] phase-2 section visibility:', presentSections);
    // The Unallocated records queue, Unallocated spend summary, and full
    // Budget activity timeline card were removed. Excluded records is the
    // only remaining standalone Phase 2 card; the compact Recent activity
    // preview inside the workspace still consumes the audit-log fetch.
    await expect(page.locator('#budget-unallocated-queue')).toHaveCount(0);
    await expect(page.locator('#budget-unallocated-card')).toHaveCount(0);
    await expect(page.locator('#budget-activity-card')).toHaveCount(0);
    await expect(page.locator('#budget-recent-activity-card')).toHaveCount(0);
    await expect(page.locator('#budget-attention-card')).toHaveCount(0);
    await expect(page.locator('#budget-excluded-card')).toHaveCount(1);
    console.log('[P2] console issues:', JSON.stringify(log.filter(e => e.t === 'error' || e.t === 'pageerror')));
});

test('P3: ledger row carries a budget chip', async ({ page }) => {
    const log = [];
    attachLog(page, log);
    await page.goto('/ledger.html');
    await page.waitForSelector('#ledger-table-body tr[data-ledger-id]', { timeout: 20000 });
    await page.waitForTimeout(1500);
    const chipCount = await page.locator('#ledger-table-body [data-fluxy-budget-action]').count();
    console.log('[P3] ledger budget chip count:', chipCount);
    await page.screenshot({ path: `${SHOTS}/P3-ledger-chips.png`, fullPage: false });
    // At least one in-period spend transaction should show a chip (the QA account has plenty).
    expect(chipCount).toBeGreaterThan(0);
});

test('P3b: ledger budget chip opens the assignment drawer', async ({ page }) => {
    await page.goto('/ledger.html');
    await page.waitForSelector('#ledger-table-body [data-fluxy-budget-action]', { timeout: 20000 });
    const firstChip = page.locator('#ledger-table-body [data-fluxy-budget-action]').first();
    await expect(firstChip).toBeVisible();
    await firstChip.click();
    await page.waitForSelector('#fbx-assignment-drawer:not(.translate-x-full)', { timeout: 5000 });
    await expect(page.locator('#fbx-assignment-title')).toHaveText(/Change allocation|Exclude from budget|Restore to budget/);
    await page.screenshot({ path: `${SHOTS}/P3b-ledger-chip-drawer.png`, fullPage: false });
});

test('P4: bills row carries a budget chip', async ({ page }) => {
    const log = [];
    attachLog(page, log);
    await page.goto('/bill.html');
    await page.waitForSelector('#bill-table-body tr[data-bill-id]', { timeout: 20000 });
    await page.waitForTimeout(1500);
    const chipCount = await page.locator('#bill-table-body [data-fluxy-budget-action]').count();
    console.log('[P4] bill budget chip count:', chipCount);
    await page.screenshot({ path: `${SHOTS}/P4-bill-chips.png`, fullPage: false });
    expect(chipCount).toBeGreaterThan(0);
});

test('P5: FluxyBudgetAssignment is exposed on /budget /ledger /bill', async ({ page }) => {
    for (const path of ['/budget.html', '/ledger.html', '/bill.html']) {
        await page.goto(path);
        await page.waitForFunction(() => typeof window.FluxyBudgetAssignment?.open === 'function', { timeout: 10000 });
        const ok = await page.evaluate(() => typeof window.FluxyBudgetAssignment?.open === 'function');
        console.log(`[P5] ${path} → FluxyBudgetAssignment.open is a function:`, ok);
        expect(ok).toBe(true);
    }
});

test('P6: calculation invariant — totals reconcile against allocation+unallocated sums', async ({ page }) => {
    const log = [];
    attachLog(page, log);
    await openFirstPeriodDetail(page);
    // Sum the allocation table's Spent + Reserved cells.
    const rowTotals = await page.evaluate(() => {
        const rows = document.querySelectorAll('#budget-alloc-body tr[data-action="open-allocation-drill-in"]');
        const parseRp = (s) => parseInt((s.match(/Rp\s*([\d.]+)/)?.[1] || '0').replace(/\./g, ''), 10);
        let spentReserved = 0;
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            spentReserved += parseRp(cells[2]?.innerText || '');
        });
        return { spentReserved };
    });
    // Summary card readings.
    const summary = await page.evaluate(() => {
        const parseRp = (id) => parseInt((document.getElementById(id)?.innerText.match(/Rp\s*([\d.]+)/)?.[1] || '0').replace(/\./g, ''), 10);
        return {
            total: parseRp('budget-total'),
            spent: parseRp('budget-spent')  // actual + committed combined
        };
    });
    console.log('[P6] rowTotals:', rowTotals);
    console.log('[P6] summary:', summary);
    // The allocation-row Spent + Reserved sum should match the summary's Spent + Reserved
    // (they're both computed by getBudgetUsage's resolver).
    expect(rowTotals.spentReserved).toBe(summary.spent);
});
