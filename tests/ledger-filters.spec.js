// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: ledger trust cards, attention queue, and Status + Type filters.
 * Filters live behind a single "Filters" entry point that opens a staged
 * panel (Visibility segmented control + Status/Type/Cash custom dropdowns);
 * selections apply only on "Apply filters".
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
    // The single Filters entry point is visible; the custom selects mount inside
    // the (initially hidden) panel, so wait for them attached, not visible.
    await page.waitForSelector('#ledger-filter-trigger');
    await page.waitForSelector('#ledger-status-filter .fluxy-select-trigger', { state: 'attached' });
    await page.waitForSelector('#ledger-type-filter .fluxy-select-trigger', { state: 'attached' });
}

async function openFilterPanel(page) {
    const panel = page.locator('#ledger-filter-panel');
    if (await panel.isHidden()) {
        await page.locator('#ledger-filter-trigger').click();
    }
    await expect(panel).toBeVisible();
}

async function applyFilters(page) {
    await page.locator('#ledger-filter-apply').click();
    await expect(page.locator('#ledger-filter-panel')).toBeHidden();
}

// Pick a Status/Type/Cash dropdown option. The panel must already be open.
async function pickFluxyOption(page, selectId, value) {
    const root = page.locator(`#${selectId}`);
    const trigger = root.locator('.fluxy-select-trigger');
    const option = root.locator(`.fluxy-select-option[data-value="${value}"]`);
    await expect(async () => {
        if ((await root.getAttribute('data-open')) !== 'true') {
            await trigger.click();
        }
        await option.click({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
}

// Pick a Visibility segmented value. The panel must already be open.
async function pickVisibility(page, value) {
    await page.locator(`#ledger-visibility-filter .fluxy-filter-segment-btn[data-value="${value}"]`).click();
}

test('ledger page renders the single Filters panel and removes Status/Type breakdown panels', async ({ page }) => {
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

    // One Filters entry point; panel starts closed.
    const trigger = page.locator('#ledger-filter-trigger');
    await expect(trigger).toBeVisible();
    await expect(trigger.locator('.fluxy-select-label')).toHaveText('Filters');
    await expect(page.locator('#ledger-filter-panel')).toBeHidden();
    await expect(page.locator('#ledger-filter-count')).toBeHidden();

    // Open the panel: the grouped controls and default labels appear.
    await openFilterPanel(page);
    const statusRoot = page.locator('#ledger-status-filter');
    const typeRoot = page.locator('#ledger-type-filter');
    await expect(statusRoot.locator('.fluxy-select-trigger')).toBeVisible();
    await expect(typeRoot.locator('.fluxy-select-trigger')).toBeVisible();
    await expect(statusRoot.locator('.fluxy-select-label')).toHaveText('All statuses');
    await expect(typeRoot.locator('.fluxy-select-label')).toHaveText('All types');
    // Visibility is a segmented control defaulting to Active.
    await expect(page.locator('#ledger-visibility-filter .fluxy-filter-segment-btn[data-value="active"]')).toHaveAttribute('aria-checked', 'true');

    // Native <select> not present
    await expect(page.locator('select#ledger-status-filter')).toHaveCount(0);
    await expect(page.locator('select#ledger-type-filter')).toHaveCount(0);

    // Status options
    await statusRoot.locator('.fluxy-select-trigger').click();
    const statusValues = await statusRoot.locator('.fluxy-select-option').evaluateAll(els => els.map(e => e.dataset.value));
    expect(statusValues).toEqual(['', 'Completed', 'Missing Receipt', 'Pending', 'Reconciled', 'Cancelled', 'Voided']);
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

test('staged Status filter previews, applies on Apply, shows a chip, and badges the trigger', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => { consoleErrors.push(String(err)); });

    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    const summary = page.locator('#ledger-page-summary');
    const initialSummary = (await summary.textContent()) || '';

    // Stage the selection — table must NOT change until Apply.
    await openFilterPanel(page);
    await pickFluxyOption(page, 'ledger-status-filter', 'Completed');
    await expect(page.locator('#ledger-filter-applied-badge')).toContainText('1 applied');
    await expect(page.locator('#ledger-filter-result-count')).toContainText(/Results: /);
    await expect(page.locator('#ledger-filter-chip-row')).toBeHidden();
    await expect(summary).toHaveText(initialSummary);

    await applyFilters(page);

    // Trigger badge reflects the committed filter.
    await expect(page.locator('#ledger-filter-count')).toHaveText('1');
    await expect(page.locator('#ledger-filter-trigger')).toHaveAttribute('data-active', 'true');

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
    await expect(page.locator('#ledger-status-filter .fluxy-select-label')).toHaveText('All statuses');
    await expect(page.locator('#ledger-filter-trigger')).toHaveAttribute('data-active', 'false');
    await expect(page.locator('#ledger-filter-count')).toBeHidden();
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

    // Stage both filters in one panel session, then apply.
    await openFilterPanel(page);
    await pickFluxyOption(page, 'ledger-status-filter', 'Completed');
    await pickFluxyOption(page, 'ledger-type-filter', 'expense');
    await expect(page.locator('#ledger-filter-applied-badge')).toContainText('2 applied');
    await applyFilters(page);

    await expect(page.locator('#ledger-filter-count')).toHaveText('2');

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
    await expect(page.locator('#ledger-filter-count')).toHaveText('1');
    await expect(chipRow.locator('[data-filter-clear="status"]')).toBeVisible();

    expect(consoleErrors, 'console errors during combined flow').toEqual([]);
});

test('Visibility segmented filter can switch to Voided/All and clear independently', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => { consoleErrors.push(String(err)); });

    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    await openFilterPanel(page);
    await pickVisibility(page, 'voided');
    await expect(page.locator('#ledger-visibility-filter .fluxy-filter-segment-btn[data-value="voided"]')).toHaveAttribute('aria-checked', 'true');
    await applyFilters(page);
    await expect(page.locator('#ledger-filter-chip-row [data-filter-clear="visibility"]')).toContainText('Visibility: Voided');
    await expect(page.locator('#ledger-filter-trigger')).toHaveAttribute('data-active', 'true');

    // Clear the chip → back to Active default (no chip, no badge).
    await page.locator('#ledger-filter-chip-row [data-filter-clear="visibility"]').click();
    await expect(page.locator('#ledger-filter-chip-row [data-filter-clear="visibility"]')).toHaveCount(0);
    await expect(page.locator('#ledger-filter-count')).toBeHidden();
    // Reopening shows Active re-selected.
    await openFilterPanel(page);
    await expect(page.locator('#ledger-visibility-filter .fluxy-filter-segment-btn[data-value="active"]')).toHaveAttribute('aria-checked', 'true');

    await pickVisibility(page, 'all');
    await applyFilters(page);
    await expect(page.locator('#ledger-filter-chip-row [data-filter-clear="visibility"]')).toContainText('Visibility: All');

    expect(consoleErrors, 'console errors during Visibility flow').toEqual([]);
});

test('Reset clears staged selections; Cancel/close reverts uncommitted changes', async ({ page }) => {
    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    // Stage a filter, then Reset → applied badge clears without committing.
    await openFilterPanel(page);
    await pickFluxyOption(page, 'ledger-status-filter', 'Completed');
    await expect(page.locator('#ledger-filter-applied-badge')).toContainText('1 applied');
    await page.locator('#ledger-filter-reset').click();
    await expect(page.locator('#ledger-status-filter .fluxy-select-label')).toHaveText('All statuses');
    await expect(page.locator('#ledger-filter-applied-badge')).toBeHidden();

    // Stage again, then close (✕) without applying → nothing committed.
    await pickFluxyOption(page, 'ledger-status-filter', 'Pending');
    await page.locator('#ledger-filter-close').click();
    await expect(page.locator('#ledger-filter-panel')).toBeHidden();
    await expect(page.locator('#ledger-filter-count')).toBeHidden();
    await expect(page.locator('#ledger-filter-chip-row')).toBeHidden();

    // Reopening reseeds from the (still empty) committed state.
    await openFilterPanel(page);
    await expect(page.locator('#ledger-status-filter .fluxy-select-label')).toHaveText('All statuses');
});

test('filter panel closes on outside click and on Escape', async ({ page }) => {
    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    const panel = page.locator('#ledger-filter-panel');

    // Outside click closes the panel
    await openFilterPanel(page);
    await page.locator('h1').click();
    await expect(panel).toBeHidden();

    // Escape closes the panel
    await openFilterPanel(page);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
});

test('inside the panel, opening one dropdown auto-closes the other', async ({ page }) => {
    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    await openFilterPanel(page);
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

    // In the stacked panel the open Status menu overlays the Type trigger below
    // it, so a real pointer click would land on the menu. Dispatch the trigger's
    // own click to exercise the JS single-open (auto-close) invariant directly.
    await typeRoot.locator('.fluxy-select-trigger').evaluate(el => el.click());
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
