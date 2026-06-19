// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: ledger trust cards, attention queue, and Status + Type filters.
 * Filters are rendered as a custom Fluxy dropdown (not native <select>).
 * Authenticates via tests/setup-auth.spec.js → tests/.auth/storageState.json.
 */

// The shared QA account's trial periodically lapses, which renders an
// interaction-blocking billing paywall over the page. Strip it so these
// filter/interaction specs exercise the ledger, not the billing gate.
test.beforeEach(async ({ page }) => {
    await installTrialPaywallBypass(page);
});

async function waitForLedgerReady(page) {
    await page.waitForSelector('#ledger-table-body');
    await page.waitForFunction(() => {
        const body = document.querySelector('#ledger-table-body');
        return !!body && !/Fetching ledger data/.test(body.textContent || '');
    }, null, { timeout: 20_000 });
    // Wait for the custom selects to mount.
    await page.waitForSelector('#ledger-visibility-filter .fluxy-select-trigger');
    await page.waitForSelector('#ledger-status-filter .fluxy-select-trigger');
    await page.waitForSelector('#ledger-type-filter .fluxy-select-trigger');
}

async function pickFluxyOption(page, selectId, value) {
    const root = page.locator(`#${selectId}`);
    const trigger = root.locator('.fluxy-select-trigger');
    const option = root.locator(`.fluxy-select-option[data-value="${value}"]`);
    // A chip-clear re-render can re-close the dropdown right after it opens
    // (open-state lives on root[data-open]), racing a plain trigger→option click.
    // Poll: ensure the menu is open, then click the option, retrying the whole
    // step until one attempt lands.
    await expect(async () => {
        if ((await root.getAttribute('data-open')) !== 'true') {
            await trigger.click();
        }
        await option.click({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
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
    const visibilityRoot = page.locator('#ledger-visibility-filter');
    const statusRoot = page.locator('#ledger-status-filter');
    const typeRoot = page.locator('#ledger-type-filter');
    await expect(visibilityRoot.locator('.fluxy-select-trigger')).toBeVisible();
    await expect(statusRoot.locator('.fluxy-select-trigger')).toBeVisible();
    await expect(typeRoot.locator('.fluxy-select-trigger')).toBeVisible();
    await expect(visibilityRoot.locator('.fluxy-select-label')).toHaveText('Active');
    await expect(statusRoot.locator('.fluxy-select-label')).toHaveText('All statuses');
    await expect(typeRoot.locator('.fluxy-select-label')).toHaveText('All types');

    // Native <select> not present
    await expect(page.locator('select#ledger-status-filter')).toHaveCount(0);
    await expect(page.locator('select#ledger-type-filter')).toHaveCount(0);

    // Status options
    await statusRoot.locator('.fluxy-select-trigger').click();
    const statusValues = await statusRoot.locator('.fluxy-select-option').evaluateAll(els => els.map(e => e.dataset.value));
    expect(statusValues).toEqual(['', 'Completed', 'Missing Receipt', 'Pending', 'Reconciled', 'Cancelled', 'Voided']);
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

test('ledger trust cards and attention queue render safely above the table', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => { consoleErrors.push(String(err)); });

    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    await expect(page.locator('#ledger-control-cards')).toBeVisible();
    await expect(page.locator('#ledger-trust-score')).toHaveText(/^\d+%$/);
    await expect(page.locator('#ledger-missing-receipts-count')).toBeVisible();
    await expect(page.locator('#ledger-uncategorized-count')).toBeVisible();
    await expect(page.locator('#ledger-pending-approval-count')).toBeVisible();
    await expect(page.locator('#ledger-unreconciled-count')).toBeVisible();
    await expect(page.locator('#ledger-attention-section')).toBeVisible();
    await expect(page.locator('#ledger-attention-list')).toBeVisible();
    await expect(page.locator('[data-action="ledger-attention-tab"]')).toHaveCount(5);
    await expect(page.locator('[data-issue-tab="all"]')).toHaveAttribute('aria-selected', 'true');
    await page.locator('[data-issue-tab="missingReceipt"]').click();
    await expect(page.locator('[data-issue-tab="missingReceipt"]')).toHaveAttribute('aria-selected', 'true');
    await page.locator('[data-issue-tab="all"]').click();
    await expect(page.locator('[data-issue-tab="all"]')).toHaveAttribute('aria-selected', 'true');

    const unsafeText = await page.locator('#ledger-control-cards, #ledger-attention-section').evaluateAll(els => els.map(el => el.textContent || '').join(' '));
    expect(unsafeText).not.toMatch(/NaN|Infinity|undefined|null/);

    const trustScore = Number(((await page.locator('#ledger-trust-score').textContent()) || '').replace('%', ''));
    expect(trustScore).toBeGreaterThanOrEqual(0);
    expect(trustScore).toBeLessThanOrEqual(100);

    const order = await page.evaluate(() => {
        const table = document.querySelector('#ledger-table-container');
        const activity = document.querySelector('#ledger-activity-section');
        if (!table || !activity) return false;
        return Boolean(table.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order, 'Ledger Activity should be below the table').toBe(true);

    expect(consoleErrors, 'console errors on trust cleanup render').toEqual([]);
});

test('Add Transaction and Scan / Import controls still open their existing drawers', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => { consoleErrors.push(String(err)); });

    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    await page.locator('[data-tour-target="ledger-add-transaction"]').click();
    await expect(page.locator('#global-tx-modal')).toBeVisible();
    await expect(page.locator('#global-tx-title')).toContainText('Add Transaction');
    await page.evaluate(() => window.closeAddTransactionModal?.());
    await expect(page.locator('#global-tx-modal')).toHaveCount(0, { timeout: 5_000 });

    await page.locator('#scan-tx-btn').click();
    await expect(page.locator('#scan-drawer')).not.toHaveClass(/translate-x-full/);
    await expect(page.locator('#scan-drawer-content')).toBeVisible();
    await page.locator('#scan-drawer-close-btn').click();

    expect(consoleErrors, 'console errors during safe drawer open checks').toEqual([]);
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
    const statusBadges = page.locator('#ledger-table-body tr td:nth-child(7) span');
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

test('Visibility filter can switch to Voided/All and clear independently', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => { consoleErrors.push(String(err)); });

    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    await pickFluxyOption(page, 'ledger-visibility-filter', 'voided');
    const visibilityRoot = page.locator('#ledger-visibility-filter');
    await expect(visibilityRoot.locator('.fluxy-select-label')).toHaveText('Voided');
    await expect(visibilityRoot.locator('.fluxy-select-trigger')).toHaveAttribute('data-active', 'true');
    await expect(page.locator('#ledger-filter-chip-row [data-filter-clear="visibility"]')).toContainText('Visibility: Voided');

    await page.locator('#ledger-filter-chip-row [data-filter-clear="visibility"]').click();
    await expect(visibilityRoot.locator('.fluxy-select-label')).toHaveText('Active');
    await expect(visibilityRoot.locator('.fluxy-select-trigger')).toHaveAttribute('data-active', 'false');

    await pickFluxyOption(page, 'ledger-visibility-filter', 'all');
    await expect(visibilityRoot.locator('.fluxy-select-label')).toHaveText('All');
    await expect(page.locator('#ledger-filter-chip-row [data-filter-clear="visibility"]')).toContainText('Visibility: All');

    expect(consoleErrors, 'console errors during Visibility flow').toEqual([]);
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
    const expectMenuAnchored = async (root) => {
        const triggerBox = await root.locator('.fluxy-select-trigger').boundingBox();
        const menuBox = await root.locator('.fluxy-select-menu').boundingBox();
        const viewportWidth = await page.evaluate(() => window.innerWidth);
        if (!triggerBox || !menuBox) throw new Error('Expected dropdown trigger and menu boxes to be measurable');
        const verticalGap = menuBox.y - triggerBox.y - triggerBox.height;
        expect(verticalGap).toBeGreaterThanOrEqual(4);
        expect(verticalGap).toBeLessThanOrEqual(8);
        expect(menuBox.x).toBeGreaterThanOrEqual(0);
        expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewportWidth + 1);
    };

    await statusRoot.locator('.fluxy-select-trigger').click();
    await expect(statusRoot).toHaveAttribute('data-open', 'true');
    await expect(page.locator('.fluxy-select[data-open="true"]')).toHaveCount(1);
    await expectMenuAnchored(statusRoot);

    await typeRoot.locator('.fluxy-select-trigger').click();
    await expect(typeRoot).toHaveAttribute('data-open', 'true');
    await expect(statusRoot).toHaveAttribute('data-open', 'false');
    await expect(statusRoot.locator('.fluxy-select-menu')).toBeHidden();
    await expect(page.locator('.fluxy-select[data-open="true"]')).toHaveCount(1);
    await expectMenuAnchored(typeRoot);
});

test('375px, 768px, and 1280px widths have no horizontal overflow on /ledger', async ({ page }) => {
    for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/ledger.html');
        await waitForLedgerReady(page);

        const overflow = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
        }));
        expect(overflow.scroll, `document scrollWidth at ${width}px`).toBeLessThanOrEqual(overflow.client + 1);
    }
});
