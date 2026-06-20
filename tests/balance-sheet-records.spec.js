// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: Balance Sheet → Records subpage → source record drill-down.
 *
 * Clicking a Balance Sheet line item must navigate to the dedicated
 * balance-sheet-records subpage (the Accounting Records pattern), not open an
 * in-page drawer. Every supporting record on that subpage must deep-link back
 * to its source page (`?record=<id>`), where the universal record-centric
 * system snaps the range, locates, scrolls to, and highlights the row.
 *
 * Read-only: reuses the page's authenticated Firebase session; never writes.
 */

// Rows whose supporting records are date-scoped transactions/bills (i.e. they
// deep-link with ?record=). cash_bank links to settings, not a record.
const RECORD_ROWS = ['accounts_payable', 'accounts_receivable', 'pending_payables'];

test.beforeEach(async ({ page }) => {
    await installTrialPaywallBypass(page);
});

async function waitForBalanceSheetReady(page) {
    await page.waitForSelector('#bs-table-body');
    await page.waitForFunction(() => {
        const body = document.querySelector('#bs-table-body');
        return !!body && !/Loading balance sheet/.test(body.textContent || '');
    }, null, { timeout: 20_000 });
}

async function waitForRecordsReady(page) {
    await page.waitForSelector('#bsr-body', { state: 'attached' });
    await page.waitForFunction(() => {
        const loading = document.querySelector('#bsr-loading');
        const content = document.querySelector('#bsr-content');
        const error = document.querySelector('#bsr-error');
        const loadingDone = !!loading && loading.classList.contains('hidden');
        const shown = (!!content && !content.classList.contains('hidden'))
            || (!!error && !error.classList.contains('hidden'));
        return loadingDone && shown;
    }, null, { timeout: 20_000 });
}

test('a Balance Sheet line item navigates to the records subpage (not a drawer)', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    await page.goto('/balance-sheet.html');
    await waitForBalanceSheetReady(page);

    const row = page.locator('#bs-table-body [data-open-row]').first();
    test.skip(!(await row.count()), 'QA account has no Balance Sheet source data to drill into.');

    const rowId = await row.getAttribute('data-open-row');
    await row.click();

    await page.waitForURL(/\/balance-sheet-records\?/, { timeout: 20_000 });
    expect(page.url()).toContain(`row=${rowId}`);

    await waitForRecordsReady(page);
    await expect(page.locator('#bsr-title')).toBeVisible();
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});

test('supporting records deep-link to their source and open the record', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    // Find a Balance Sheet line whose supporting records deep-link (?record=).
    let target = null;
    for (const rowId of RECORD_ROWS) {
        await page.goto(`/balance-sheet-records.html?row=${rowId}`);
        await waitForRecordsReady(page);
        const link = page.locator('#bsr-body tr[data-href*="record="]').first();
        if (await link.count()) {
            target = { rowId, href: await link.getAttribute('data-href'), link };
            break;
        }
    }
    test.skip(!target, 'QA account has no receivable/payable/bill records to drill into as of today.');

    expect(target.href, 'supporting record must be record-centric').toMatch(/[?&]record=/);
    const isBill = /\/bill\b/.test(target.href);

    await target.link.click();
    await page.waitForURL(/[?&]record=/, { timeout: 20_000 });

    if (isBill) {
        await expect(page.locator('#bill-drawer')).not.toHaveClass(/translate-x-full/, { timeout: 15_000 });
    } else {
        // Transactions (AR / pending payables) open the Ledger detail drawer.
        await expect(page.locator('#tx-detail-overlay')).toBeVisible({ timeout: 15_000 });
    }

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
