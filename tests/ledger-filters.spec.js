// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * QA: ledger Status + Type filters replace Status / Type Breakdown panels.
 * Filters are rendered as a custom Fluxy dropdown (not native <select>).
 * Authenticates via tests/setup-auth.spec.js → tests/.auth/storageState.json.
 */

async function waitForLedgerReady(page) {
    await page.waitForSelector('#ledger-table-body');
    await page.waitForFunction(() => {
        const body = document.querySelector('#ledger-table-body');
        return !!body && !/Fetching ledger data/.test(body.textContent || '');
    }, null, { timeout: 20_000 });
    // Wait for the custom selects to mount.
    await page.waitForSelector('#ledger-status-filter .fluxy-select-trigger');
    await page.waitForSelector('#ledger-type-filter .fluxy-select-trigger');
}

async function pickFluxyOption(page, selectId, value) {
    const root = page.locator(`#${selectId}`);
    await root.locator('.fluxy-select-trigger').click();
    await root.locator(`.fluxy-select-option[data-value="${value}"]`).click();
}

test('ledger page renders custom filter dropdowns and removes Status/Type breakdown panels', async ({ page }) => {
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

    // Filters: triggers visible, default labels
    const statusRoot = page.locator('#ledger-status-filter');
    const typeRoot = page.locator('#ledger-type-filter');
    await expect(statusRoot.locator('.fluxy-select-trigger')).toBeVisible();
    await expect(typeRoot.locator('.fluxy-select-trigger')).toBeVisible();
    await expect(statusRoot.locator('.fluxy-select-label')).toHaveText('All statuses');
    await expect(typeRoot.locator('.fluxy-select-label')).toHaveText('All types');

    // Native <select> not present
    await expect(page.locator('select#ledger-status-filter')).toHaveCount(0);
    await expect(page.locator('select#ledger-type-filter')).toHaveCount(0);

    // Status options
    await statusRoot.locator('.fluxy-select-trigger').click();
    const statusValues = await statusRoot.locator('.fluxy-select-option').evaluateAll(els => els.map(e => e.dataset.value));
    expect(statusValues).toEqual(['', 'Completed', 'Missing Receipt']);
    // Close menu by clicking trigger again
    await statusRoot.locator('.fluxy-select-trigger').click();

    // Type options cover required values
    await typeRoot.locator('.fluxy-select-trigger').click();
    const typeValues = await typeRoot.locator('.fluxy-select-option').evaluateAll(els => els.map(e => e.dataset.value));
    expect(typeValues).toEqual([
        '', 'income', 'expense', 'transfer', 'refund',
        'adjustment', 'fee', 'tax', 'pending_receivable', 'pending_payable'
    ]);
    await typeRoot.locator('.fluxy-select-trigger').click();

    // Chip row hidden initially
    await expect(page.locator('#ledger-filter-chip-row')).toBeHidden();

    expect(consoleErrors, 'console errors on initial load').toEqual([]);
});

test('selecting Status narrows the table, shows a chip, and tints the trigger', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => { consoleErrors.push(String(err)); });

    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    const summary = page.locator('#ledger-page-summary');
    const initialSummary = (await summary.textContent()) || '';

    await pickFluxyOption(page, 'ledger-status-filter', 'Completed');

    // Trigger label and active state
    const statusRoot = page.locator('#ledger-status-filter');
    await expect(statusRoot.locator('.fluxy-select-label')).toHaveText('Completed');
    await expect(statusRoot.locator('.fluxy-select-trigger')).toHaveAttribute('data-active', 'true');

    // Chip row visible with status chip
    const chipRow = page.locator('#ledger-filter-chip-row');
    await expect(chipRow).toBeVisible();
    await expect(chipRow.locator('[data-filter-clear="status"]')).toContainText('Status: Completed');

    // Pagination resets to 1
    await expect(page.locator('#ledger-page-indicator')).toContainText('1 / ');

    // Every visible status badge reads "Completed"
    const statusBadges = page.locator('#ledger-table-body tr td:last-child span');
    const count = await statusBadges.count();
    for (let i = 0; i < count; i++) {
        await expect(statusBadges.nth(i)).toContainText(/completed/i);
    }

    // Clear chip → back to All
    await chipRow.locator('[data-filter-clear="status"]').click();
    await expect(statusRoot.locator('.fluxy-select-label')).toHaveText('All statuses');
    await expect(statusRoot.locator('.fluxy-select-trigger')).toHaveAttribute('data-active', 'false');
    await expect(chipRow).toBeHidden();
    await expect(summary).toHaveText(initialSummary);

    expect(consoleErrors, 'console errors during Status flow').toEqual([]);
});

test('Type filter intersects with Status filter and clears independently', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => { consoleErrors.push(String(err)); });

    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    await pickFluxyOption(page, 'ledger-status-filter', 'Completed');
    await pickFluxyOption(page, 'ledger-type-filter', 'expense');

    const chipRow = page.locator('#ledger-filter-chip-row');
    await expect(chipRow.locator('[data-filter-clear="status"]')).toBeVisible();
    await expect(chipRow.locator('[data-filter-clear="type"]')).toContainText('Type: Expense');

    const typeBadges = page.locator('#ledger-table-body tr td:nth-child(3) span');
    const count = await typeBadges.count();
    for (let i = 0; i < count; i++) {
        await expect(typeBadges.nth(i)).toContainText(/expense/i);
    }

    // Clear only Type — Status persists
    await chipRow.locator('[data-filter-clear="type"]').click();
    await expect(page.locator('#ledger-type-filter .fluxy-select-label')).toHaveText('All types');
    await expect(page.locator('#ledger-status-filter .fluxy-select-label')).toHaveText('Completed');
    await expect(chipRow.locator('[data-filter-clear="status"]')).toBeVisible();

    expect(consoleErrors, 'console errors during combined flow').toEqual([]);
});

test('dropdown closes on outside click and on Escape', async ({ page }) => {
    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    const statusRoot = page.locator('#ledger-status-filter');
    const trigger = statusRoot.locator('.fluxy-select-trigger');
    const menu = statusRoot.locator('.fluxy-select-menu');

    // Outside click closes
    await trigger.click();
    await expect(statusRoot).toHaveAttribute('data-open', 'true');
    await expect(menu).toBeVisible();
    await page.locator('h1').click();
    await expect(statusRoot).toHaveAttribute('data-open', 'false');
    await expect(menu).toBeHidden();

    // Escape closes
    await trigger.click();
    await expect(statusRoot).toHaveAttribute('data-open', 'true');
    await page.keyboard.press('Escape');
    await expect(statusRoot).toHaveAttribute('data-open', 'false');
});

test('opening one dropdown auto-closes the other', async ({ page }) => {
    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    const statusRoot = page.locator('#ledger-status-filter');
    const typeRoot = page.locator('#ledger-type-filter');

    await statusRoot.locator('.fluxy-select-trigger').click();
    await expect(statusRoot).toHaveAttribute('data-open', 'true');

    await typeRoot.locator('.fluxy-select-trigger').click();
    await expect(typeRoot).toHaveAttribute('data-open', 'true');
    await expect(statusRoot).toHaveAttribute('data-open', 'false');
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
