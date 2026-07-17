// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: ledger trust cards, attention queue, and Status + Type filters.
 * Filters live behind a single "Filters" entry point that opens a staged
 * two-pane panel: a left category rail (Visibility / Status / Type / Cash)
 * whose options render as radios in the right detail pane. Selections apply
 * only on "Apply filters".
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
    await page.waitForSelector('#ledger-filter-trigger');
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

// Select a category in the left rail, then toggle one of its options in the
// right pane. The panel must already be open. Status/Type are multi-select
// (checkboxes); Visibility/Cash are single-select (radios).
async function pickFilter(page, group, value) {
    await page.locator(`#ledger-filter-rail .fluxy-filter-rail-item[data-group="${group}"]`).click();
    await page.locator(`#ledger-filter-options .fluxy-filter-option[data-value="${value}"]`).click();
}

test('ledger page renders the two-pane Filters panel and removes Status/Type breakdown panels', async ({ page }) => {
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

    // Open: rail lists the four categories, Visibility active by default.
    await openFilterPanel(page);
    const rail = page.locator('#ledger-filter-rail .fluxy-filter-rail-item');
    await expect(rail).toHaveCount(4);
    await expect(page.locator('#ledger-filter-rail .fluxy-filter-rail-item[data-group="visibility"]')).toHaveAttribute('aria-selected', 'true');
    // Default detail pane = Visibility options, Active checked.
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value="active"]')).toHaveAttribute('aria-checked', 'true');

    // Native <select> not present for these filters
    await expect(page.locator('select#ledger-status-filter')).toHaveCount(0);
    await expect(page.locator('select#ledger-type-filter')).toHaveCount(0);

    // Visibility options are single-select radios.
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value="active"]')).toHaveAttribute('role', 'radio');

    // Status category options (multi-select checkboxes).
    await page.locator('#ledger-filter-rail .fluxy-filter-rail-item[data-group="status"]').click();
    const statusValues = await page.locator('#ledger-filter-options .fluxy-filter-option').evaluateAll(els => els.map(e => e.dataset.value));
    expect(statusValues).toEqual(['', 'Completed', 'Missing Receipt', 'Pending', 'Reconciled', 'Cancelled', 'Voided']);
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value="Completed"]')).toHaveAttribute('role', 'checkbox');

    // Type category options
    await page.locator('#ledger-filter-rail .fluxy-filter-rail-item[data-group="type"]').click();
    const typeValues = await page.locator('#ledger-filter-options .fluxy-filter-option').evaluateAll(els => els.map(e => e.dataset.value));
    expect(typeValues).toEqual([
        '', 'income', 'expense', 'transfer', 'refund',
        'adjustment', 'fee', 'tax', 'pending_receivable', 'pending_payable'
    ]);

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
    // The "Needs your attention" panel renders only when the current period has
    // data-quality issues; an all-clear panel is intentionally hidden (ledger.html
    // renderAttention: `if (!items.length) section.classList.add('hidden')`). Branch
    // so this spec is correct whether the shared QA account is clean or not, instead
    // of assuming issues always exist (a clean account left it perpetually red).
    if (await page.locator('#ledger-attention-section').isVisible()) {
        await expect(page.locator('#ledger-attention-list')).toBeVisible();
        await expect(page.locator('[data-action="ledger-attention-tab"]')).toHaveCount(5);
        await expect(page.locator('[data-issue-tab="all"]')).toHaveAttribute('aria-selected', 'true');
        await page.locator('[data-issue-tab="missingReceipt"]').click();
        await expect(page.locator('[data-issue-tab="missingReceipt"]')).toHaveAttribute('aria-selected', 'true');
        await page.locator('[data-issue-tab="all"]').click();
        await expect(page.locator('[data-issue-tab="all"]')).toHaveAttribute('aria-selected', 'true');
    } else {
        // All-clear account: the panel is hidden by design, not broken.
        await expect(page.locator('#ledger-attention-section')).toHaveClass(/\bhidden\b/);
    }

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

test('switching rail categories swaps the right options pane', async ({ page }) => {
    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    await openFilterPanel(page);
    // Default: Visibility selected, its options shown.
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value="active"]')).toBeVisible();

    // Switch to Type → Type options shown, Visibility options gone.
    await page.locator('#ledger-filter-rail .fluxy-filter-rail-item[data-group="type"]').click();
    await expect(page.locator('#ledger-filter-rail .fluxy-filter-rail-item[data-group="type"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#ledger-filter-rail .fluxy-filter-rail-item[data-group="visibility"]')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value="expense"]')).toBeVisible();
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value="active"]')).toHaveCount(0);
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
    await pickFilter(page, 'status', 'Completed');
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value="Completed"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#ledger-filter-rail .fluxy-filter-rail-item[data-group="status"] .fluxy-filter-rail-dot')).toBeVisible();
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
    await pickFilter(page, 'status', 'Completed');
    await pickFilter(page, 'type', 'expense');
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
    await expect(chipRow.locator('[data-filter-clear="type"]')).toHaveCount(0);
    await expect(chipRow.locator('[data-filter-clear="status"]')).toBeVisible();
    await expect(page.locator('#ledger-filter-count')).toHaveText('1');

    // Reopening shows Type reverted to All, Status still Completed.
    await openFilterPanel(page);
    await page.locator('#ledger-filter-rail .fluxy-filter-rail-item[data-group="type"]').click();
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value=""]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('#ledger-filter-rail .fluxy-filter-rail-item[data-group="status"]').click();
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value="Completed"]')).toHaveAttribute('aria-checked', 'true');

    expect(consoleErrors, 'console errors during combined flow').toEqual([]);
});

test('Status is multi-select (OR), counts as one applied group, and shows a count chip', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => { consoleErrors.push(String(err)); });

    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    await openFilterPanel(page);
    await pickFilter(page, 'status', 'Completed');
    await pickFilter(page, 'status', 'Pending');

    // Both checked, "All statuses" unchecked, and it's still ONE applied group.
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value="Completed"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value="Pending"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value=""]')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#ledger-filter-applied-badge')).toContainText('1 applied');

    await applyFilters(page);
    await expect(page.locator('#ledger-filter-count')).toHaveText('1');
    await expect(page.locator('#ledger-filter-chip-row [data-filter-clear="status"]')).toContainText('Status: 2 selected');

    // Each visible row is Completed OR Pending.
    const statusBadges = page.locator('#ledger-table-body tr td:nth-child(7) span');
    const count = await statusBadges.count();
    for (let i = 0; i < count; i++) {
        await expect(statusBadges.nth(i)).toContainText(/completed|pending/i);
    }

    // The "All statuses" row clears the whole group.
    await openFilterPanel(page);
    await page.locator('#ledger-filter-rail .fluxy-filter-rail-item[data-group="status"]').click();
    await page.locator('#ledger-filter-options .fluxy-filter-option[data-value=""]').click();
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value="Completed"]')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#ledger-filter-applied-badge')).toBeHidden();

    expect(consoleErrors, 'console errors during multi-select flow').toEqual([]);
});

test('Visibility filter can switch to Voided/All and clear independently', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => { consoleErrors.push(String(err)); });

    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    await openFilterPanel(page);
    await pickFilter(page, 'visibility', 'voided');
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value="voided"]')).toHaveAttribute('aria-checked', 'true');
    await applyFilters(page);
    await expect(page.locator('#ledger-filter-chip-row [data-filter-clear="visibility"]')).toContainText('Visibility: Voided');
    await expect(page.locator('#ledger-filter-trigger')).toHaveAttribute('data-active', 'true');

    // Clear the chip → back to Active default (no chip, no badge).
    await page.locator('#ledger-filter-chip-row [data-filter-clear="visibility"]').click();
    await expect(page.locator('#ledger-filter-chip-row [data-filter-clear="visibility"]')).toHaveCount(0);
    await expect(page.locator('#ledger-filter-count')).toBeHidden();
    // Reopening shows Active re-selected.
    await openFilterPanel(page);
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value="active"]')).toHaveAttribute('aria-checked', 'true');

    await pickFilter(page, 'visibility', 'all');
    await applyFilters(page);
    await expect(page.locator('#ledger-filter-chip-row [data-filter-clear="visibility"]')).toContainText('Visibility: All');

    expect(consoleErrors, 'console errors during Visibility flow').toEqual([]);
});

test('Reset clears staged selections; Cancel/close reverts uncommitted changes', async ({ page }) => {
    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    // Stage a filter, then Reset → options revert without committing.
    await openFilterPanel(page);
    await pickFilter(page, 'status', 'Completed');
    await expect(page.locator('#ledger-filter-applied-badge')).toContainText('1 applied');
    await page.locator('#ledger-filter-reset').click();
    await expect(page.locator('#ledger-filter-applied-badge')).toBeHidden();
    // After reset the visible (Status) pane shows All statuses checked.
    await page.locator('#ledger-filter-rail .fluxy-filter-rail-item[data-group="status"]').click();
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value=""]')).toHaveAttribute('aria-checked', 'true');

    // Stage again, then close (✕) without applying → nothing committed.
    await pickFilter(page, 'status', 'Pending');
    await page.locator('#ledger-filter-close').click();
    await expect(page.locator('#ledger-filter-panel')).toBeHidden();
    await expect(page.locator('#ledger-filter-count')).toBeHidden();
    await expect(page.locator('#ledger-filter-chip-row')).toBeHidden();

    // Reopening reseeds from the (still empty) committed state.
    await openFilterPanel(page);
    await page.locator('#ledger-filter-rail .fluxy-filter-rail-item[data-group="status"]').click();
    await expect(page.locator('#ledger-filter-options .fluxy-filter-option[data-value=""]')).toHaveAttribute('aria-checked', 'true');
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
