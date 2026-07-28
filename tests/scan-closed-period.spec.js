// @ts-check
const { test, expect } = require('@playwright/test');

// When a scanned transaction's date lands in a CLOSED accounting period, the
// kernel refuses to post and throws an actionable message ("Reopen the period,
// or use a date in an open period"). The scan flow must surface THAT reason, not
// a generic "Could not save. Please try again." — retrying can never fix a closed
// period, and the scanned date field is editable. We force the kernel error
// deterministically (stub the save) so the test doesn't depend on the workspace's
// live period state, and assert the toast carries the real reason.

test('Scan save surfaces the closed-period reason, not a generic retry', async ({ page }) => {
    await page.goto('/ledger.html');
    await page.waitForFunction(() => typeof window.openScanDrawerWithFile === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => !!(window.__fluxyTxContext && window.__fluxyTxContext.auth && window.__fluxyTxContext.auth.currentUser), null, { timeout: 30000 });

    // Capture toasts and force the kernel's closed-period error on save.
    await page.evaluate(() => {
        window.__toasts = [];
        const orig = window.showToast;
        window.showToast = (msg, type) => {
            window.__toasts.push({ msg: String(msg), type });
            if (typeof orig === 'function') { try { orig(msg, type); } catch (_) { /* ignore */ } }
        };
        window.__fluxyTxContext.ds.addTransaction = async () => {
            throw new Error('Cannot post to a closed accounting period (2026-06). Reopen the period, or use a date in an open period.');
        };
    });

    // Open the scan review in transaction mode with a mock extraction dated in a
    // (would-be) closed period.
    await page.evaluate(() => {
        const file = new File(['%PDF-1.4 test'], 'receipt.pdf', { type: 'application/pdf' });
        window.openScanDrawerWithFile('transaction', file, {
            extraction: {
                vendor_name: `QA Closed ${Date.now()}`, amount: 250000, category: 'Operations',
                type: 'expense', transaction_date: '2026-06-30', document_type: 'transaction',
                confidence: { overall: 0.9 }
            },
            extractionSource: 'prefilled'
        });
    });

    // Save once the review renders.
    const saveBtn = page.locator('#scan-save-btn');
    await expect(saveBtn).toBeVisible({ timeout: 15000 });
    await expect(saveBtn).toBeEnabled({ timeout: 15000 });
    await saveBtn.click();

    // The toast carries the actionable closed-period reason — and never the
    // generic "please try again".
    await expect.poll(
        async () => page.evaluate(() => (window.__toasts || []).map((t) => `${t.type}:${t.msg}`).join('\n')),
        { timeout: 10000 }
    ).toMatch(/closed accounting period/i);
    const toasts = await page.evaluate(() => window.__toasts || []);
    expect(toasts.some((t) => /please try again/i.test(t.msg))).toBe(false);
});
