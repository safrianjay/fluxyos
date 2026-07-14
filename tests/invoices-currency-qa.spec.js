// =============================================================================
// FluxyOS — Multi-currency invoice QA (live Firestore, authenticated)
//
// Reproduces the reported bug: finalizing a USD invoice failed with
// "Missing or insufficient permissions" because finalize posted the invoice
// total (in USD cents) into the IDR-only accounting kernel. Foreign-currency
// invoices must finalize as a plain receivable (no INV-ISSUE journal), display
// in their currency, and convert to IDR only on payment.
//
// Run: npx playwright test tests/invoices-currency-qa.spec.js --project=chromium
// =============================================================================

const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

test('invoices: USD invoice finalizes (no permission error) + displays in $ + pays in IDR', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('/invoices');
    await page.waitForTimeout(1500);
    if (await page.locator('[data-fluxy-paywall]').count()) {
        test.skip(true, 'QA account is paywalled — invoice JS does not initialize.');
    }
    await expect(page.locator('#invoice-list-view')).toBeVisible();
    await page.waitForTimeout(1500);

    // --- Create a USD draft ---
    await page.locator('#invoice-create-btn').click();
    await expect(page.locator('#invoice-editor-view')).toBeVisible();

    const stamp = Date.now().toString().slice(-6);
    await page.locator('#inv-customer-name').fill(`USD Customer ${stamp}`);
    await page.locator('#inv-customer-email').fill(`qa+usd${stamp}@example.com`);
    await page.locator('#inv-currency').selectOption('USD');

    // Unit-price label reflects the selected currency.
    await page.locator('#invoice-item-add').click();
    await expect(page.locator('#invoice-item-form')).toBeVisible();
    await expect(page.locator('#inv-item-price-currency')).toHaveText('($)');
    await page.locator('#inv-item-description').fill('Fee');
    await page.locator('#inv-item-qty').fill('1');
    await page.locator('#inv-item-price').fill('8,100.00');
    // Amount hint formats in USD.
    await expect(page.locator('#invoice-item-amount-hint')).toContainText('$8,100.00');
    await page.locator('#invoice-item-save').click();
    await expect(page.locator('#invoice-items-empty')).toBeHidden();

    // --- Finalize only: MUST succeed (the bug threw a permissions error here) ---
    await page.locator('#invoice-review-btn').click();
    await expect(page.locator('#invoice-review-modal')).toBeVisible();
    await expect(page.locator('#review-amount')).toContainText('$8,100.00');
    await page.locator('#review-finalize-btn').click();

    // Lands on detail as an open invoice — no permission error, no stuck modal.
    await expect(page.locator('#invoice-detail-view')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#detail-status')).toContainText(/open/i);
    await expect(page.locator('#detail-currency')).toHaveText('USD');
    await expect(page.locator('#detail-amount-due')).toContainText('$8,100.00');
    await expect(page.locator('#detail-subtotal')).toContainText('$8,100.00');

    // --- Mark paid: foreign invoice shows the IDR conversion block ---
    await page.locator('#detail-paid-btn').click();
    await expect(page.locator('#invoice-paid-modal')).toBeVisible();
    await expect(page.locator('#paid-amount')).toContainText('$8,100.00'); // invoice total in USD
    await expect(page.locator('#paid-fx')).toBeVisible();
    // The static test server has no fx-rate function, so enter the IDR manually
    // (the same path a user takes to override the rate).
    await page.locator('#paid-fx-idr').fill('130000000');
    await page.locator('#paid-confirm').click();

    // Paid is terminal; the ledger recorded the Rupiah amount.
    await expect(page.locator('#detail-activity')).toContainText(/Payment completed/i, { timeout: 15000 });
    await expect(page.locator('#detail-status')).toContainText(/paid/i);

    expect(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
