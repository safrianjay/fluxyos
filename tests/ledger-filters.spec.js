// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * QA: ledger Status + Type filters replace Status / Type Breakdown panels.
 * Authenticates via tests/setup-auth.spec.js → tests/.auth/storageState.json.
 */

async function waitForLedgerReady(page) {
    await page.waitForSelector('#ledger-table-body');
    await page.waitForFunction(() => {
        const body = document.querySelector('#ledger-table-body');
        return !!body && !/Fetching ledger data/.test(body.textContent || '');
    }, null, { timeout: 20_000 });
}

test('ledger page renders new filter controls and removes Status/Type breakdown panels', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => { consoleErrors.push(String(err)); });

    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    // Breakdown panels gone
    await expect(page.locator('#ledger-status-chart')).toHaveCount(0);
    await expect(page.locator('#ledger-type-chart')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Status Breakdown' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Type Breakdown' })).toHaveCount(0);

    // Filters present, default "All"
    const statusSelect = page.locator('#ledger-status-filter');
    const typeSelect = page.locator('#ledger-type-filter');
    await expect(statusSelect).toBeVisible();
    await expect(typeSelect).toBeVisible();
    await expect(statusSelect).toHaveValue('');
    await expect(typeSelect).toHaveValue('');

    // Status options
    await expect(statusSelect.locator('option')).toHaveCount(3);
    await expect(statusSelect.locator('option[value="Completed"]')).toHaveText('Completed');
    await expect(statusSelect.locator('option[value="Missing Receipt"]')).toHaveText('Missing Receipt');

    // Type options cover required values
    const typeValues = await typeSelect.locator('option').evaluateAll(els => els.map(e => e.value));
    expect(typeValues).toEqual([
        '', 'income', 'expense', 'transfer', 'refund',
        'adjustment', 'fee', 'tax', 'pending_receivable', 'pending_payable'
    ]);

    // Chip row is hidden when no filter active
    await expect(page.locator('#ledger-filter-chip-row')).toBeHidden();

    // Volume chart spans full width by default (when no Top Vendor Spend)
    const vendorSection = page.locator('#ledger-top-vendor-spend-section');
    const volumeCol = page.locator('#ledger-volume-col');
    const vendorHidden = await vendorSection.evaluate(el => el.classList.contains('hidden'));
    if (vendorHidden) {
        await expect(volumeCol).toHaveClass(/xl:col-span-5/);
    } else {
        await expect(volumeCol).toHaveClass(/xl:col-span-3/);
    }

    expect(consoleErrors, 'console errors on initial load').toEqual([]);
});

test('selecting Status filter narrows the table, shows a chip, and resets pagination', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => { consoleErrors.push(String(err)); });

    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    const summary = page.locator('#ledger-page-summary');
    const initialSummary = (await summary.textContent()) || '';

    // Choose Completed
    await page.locator('#ledger-status-filter').selectOption('Completed');

    // Chip row visible with Status chip
    const chipRow = page.locator('#ledger-filter-chip-row');
    await expect(chipRow).toBeVisible();
    await expect(chipRow.locator('[data-filter-clear="status"]')).toContainText('Status: Completed');

    // Page indicator resets to 1
    await expect(page.locator('#ledger-page-indicator')).toContainText('1 / ');

    // Active select adopts orange accent
    await expect(page.locator('#ledger-status-filter')).toHaveClass(/border-\[#EA580C\]/);

    // Every visible status badge reads "Completed"
    const statusBadges = page.locator('#ledger-table-body tr td:last-child span');
    const count = await statusBadges.count();
    if (count > 0) {
        for (let i = 0; i < count; i++) {
            await expect(statusBadges.nth(i)).toContainText(/completed/i);
        }
    }

    // Clear chip → back to no filter
    await chipRow.locator('[data-filter-clear="status"]').click();
    await expect(page.locator('#ledger-status-filter')).toHaveValue('');
    await expect(chipRow).toBeHidden();
    await expect(summary).toHaveText(initialSummary);

    expect(consoleErrors, 'console errors during Status filter flow').toEqual([]);
});

test('Type filter intersects with Status filter and clears independently', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => { consoleErrors.push(String(err)); });

    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    await page.locator('#ledger-status-filter').selectOption('Completed');
    await page.locator('#ledger-type-filter').selectOption('expense');

    const chipRow = page.locator('#ledger-filter-chip-row');
    await expect(chipRow.locator('[data-filter-clear="status"]')).toBeVisible();
    await expect(chipRow.locator('[data-filter-clear="type"]')).toContainText('Type: Expense');

    // Each visible row should be type=Expense badge
    const typeBadges = page.locator('#ledger-table-body tr td:nth-child(3) span');
    const count = await typeBadges.count();
    for (let i = 0; i < count; i++) {
        await expect(typeBadges.nth(i)).toContainText(/expense/i);
    }

    // Clear Type chip — Status stays
    await chipRow.locator('[data-filter-clear="type"]').click();
    await expect(page.locator('#ledger-type-filter')).toHaveValue('');
    await expect(page.locator('#ledger-status-filter')).toHaveValue('Completed');
    await expect(chipRow.locator('[data-filter-clear="status"]')).toBeVisible();

    expect(consoleErrors, 'console errors during combined filter flow').toEqual([]);
});

test('375px mobile width has no horizontal overflow on /ledger', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll, 'document scrollWidth').toBeLessThanOrEqual(overflow.client + 1);
});
