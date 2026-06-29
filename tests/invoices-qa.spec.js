// =============================================================================
// FluxyOS — Invoices QA (live Firestore, authenticated)
//
// Covers the changes in this task:
//   • Mark-as-sent works (regression: the handler used to throw after the
//     confirm dialog because event.currentTarget was null post-dispatch).
//   • Edit button is visible on a finalize-only (open + unsent) invoice and
//     disappears once the invoice is marked sent.
//   • Detail "Back to invoices" returns to the list.
//   • Page is structurally healthy (sidebar, no marketing footer) and throws
//     no uncaught errors during the flow.
//
// Run: npx playwright test tests/invoices-qa.spec.js --project=chromium
// =============================================================================

const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

test('invoices: finalize-only edit affordance + mark-as-sent regression', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('/invoices');

    // The shared QA account hard-paywalls when its billing trial has expired,
    // which short-circuits page init before the invoice JS mounts. Skip rather
    // than fail — this is an account/billing state issue, not an invoices bug.
    await page.waitForTimeout(1500);
    if (await page.locator('[data-fluxy-paywall]').count()) {
        test.skip(true, 'QA account is paywalled (expired trial) — invoice JS does not initialize. Reset the trial/billing state to run this spec.');
    }

    // Structural health: shared app sidebar present, marketing footer absent.
    await expect(page.locator('#sidebar')).toBeVisible();
    await expect(page.locator('.site-footer, #site-footer, footer.footer')).toHaveCount(0);

    // Wait for the list view to settle (loading skeleton -> content).
    await expect(page.locator('#invoice-list-view')).toBeVisible();
    await page.waitForTimeout(1500);

    // --- Create a draft ---
    await page.locator('#invoice-create-btn').click();
    await expect(page.locator('#invoice-editor-view')).toBeVisible();

    const stamp = Date.now().toString().slice(-6);
    await page.locator('#inv-customer-name').fill(`QA Customer ${stamp}`);
    await page.locator('#inv-customer-email').fill(`qa+${stamp}@example.com`);

    // Add one line item.
    await page.locator('#invoice-item-add').click();
    await expect(page.locator('#invoice-item-form')).toBeVisible();
    await page.locator('#inv-item-description').fill('QA consulting');
    await page.locator('#inv-item-qty').fill('1');
    await page.locator('#inv-item-price').fill('1000000');
    await page.locator('#invoice-item-save').click();
    await expect(page.locator('#invoice-items-empty')).toBeHidden();

    // --- Finalize only (-> open, unsent) ---
    await page.locator('#invoice-review-btn').click();
    await expect(page.locator('#invoice-review-modal')).toBeVisible();
    const finalizeBtn = page.locator('#review-finalize-btn');
    await expect(finalizeBtn).toBeEnabled();
    await finalizeBtn.click();

    // Lands on the detail view.
    await expect(page.locator('#invoice-detail-view')).toBeVisible();
    await expect(page.locator('#detail-status')).toContainText(/open/i);

    // Finalize-only invoice: Edit + Mark-as-sent are available.
    await expect(page.locator('#detail-edit-btn')).toBeVisible();
    await expect(page.locator('#detail-sent-btn')).toBeVisible();

    // --- Mark as sent (the regression under test) ---
    await page.locator('#detail-sent-btn').click();
    const confirmBtn = page.locator('[data-dialog-action="confirm"]');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // After marking sent: the detail re-renders with sent activity, and the
    // mark-as-sent + edit affordances are gone (full editing now locked).
    await expect(page.locator('#detail-activity')).toContainText(/Marked as sent/i, { timeout: 15000 });
    await expect(page.locator('#detail-sent-btn')).toBeHidden();
    await expect(page.locator('#detail-edit-btn')).toBeHidden();

    // --- Mark payment completed (open -> paid + ledger transaction) ---
    await expect(page.locator('#detail-paid-btn')).toBeVisible();
    await page.locator('#detail-paid-btn').click();
    await expect(page.locator('#invoice-paid-modal')).toBeVisible();
    await expect(page.locator('#paid-amount')).toContainText(/^Rp/);
    await page.locator('#paid-confirm').click();

    // Paid is terminal: green badge, payment activity, all mutating actions gone.
    await expect(page.locator('#detail-activity')).toContainText(/Payment completed/i, { timeout: 15000 });
    await expect(page.locator('#detail-status')).toContainText(/paid/i);
    await expect(page.locator('#detail-paid-btn')).toBeHidden();
    await expect(page.locator('#detail-void-btn')).toBeHidden();
    await expect(page.locator('#detail-edit-btn')).toBeHidden();
    await expect(page.locator('#detail-sent-btn')).toBeHidden();

    // --- Back link (now in the sticky topbar) returns to the list ---
    await page.locator('#invoice-topbar-back').click();
    await expect(page.locator('#invoice-list-view')).toBeVisible();
    await expect(page.locator('#invoice-detail-view')).toBeHidden();

    // No uncaught exceptions / unhandled rejections during the whole flow
    // (pre-fix, clicking Mark as sent threw a TypeError here).
    expect(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
