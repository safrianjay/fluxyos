// @ts-check
const { test, expect } = require('@playwright/test');

// Phase 3b: the AI scan review step shows an Account field, pre-filled from the
// vendor/keyword/category suggestion chain, with a "source" badge, and editable
// before saving. Drives the review directly via openScanDrawerWithFile with a
// mock extraction (no backend AI call, no record saved). Real Firestore + rules.

test('Scan review shows an Account field pre-filled from a keyword rule', async ({ page }) => {
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

    const token = `scan${Date.now()}`;

    await page.goto('/bill.html');
    await page.waitForFunction(() => typeof window.openScanDrawerWithFile === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof window.FluxyAccountPicker === 'object', null, { timeout: 30000 });
    await page.waitForFunction(() => !!(window.__fluxyBillsContext && window.__fluxyBillsContext.auth && window.__fluxyBillsContext.auth.currentUser), null, { timeout: 30000 });

    // Seed a keyword rule → the review should pre-fill 6440 and badge "From keyword rule".
    await page.evaluate(async (tok) => {
        const ds = window.__fluxyBillsContext.ds;
        const uid = window.__fluxyBillsContext.auth.currentUser.uid;
        const wsId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || uid;
        ds.setActor(uid);
        await ds.saveKeywordAccountRule(wsId, { keyword: tok, account_code: '6440' });
    }, token);

    // Open the scan review with a mock extraction whose vendor contains the keyword.
    await page.evaluate((tok) => {
        const file = new File(['%PDF-1.4 test'], 'bill.pdf', { type: 'application/pdf' });
        window.openScanDrawerWithFile('bill', file, {
            extraction: { vendor_name: `Trip ${tok} co`, amount: 500000, category: 'Operations', document_type: 'bill', confidence: { overall: 0.9 } },
            extractionSource: 'prefilled'
        });
    }, token);

    // The Account field + searchable picker render, pre-filled to the keyword rule's
    // account (6440), with the source badge naming the keyword rule.
    const trigger = page.locator('[data-scan-account-mount] .fluxy-acct-trigger');
    await expect(trigger).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => page.$eval('[data-scan-account-mount] input[name="account_code"]', (el) => el.value), { timeout: 15000 })
        .toBe('6440');
    await expect(page.locator('#scan-account-source')).toContainText(/keyword/i, { timeout: 5000 });

    // Clean up the seeded rule.
    await page.evaluate(async (tok) => {
        const ds = window.__fluxyBillsContext.ds;
        const uid = window.__fluxyBillsContext.auth.currentUser.uid;
        const wsId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || uid;
        await ds.archiveKeywordAccountRule(wsId, tok);
    }, token);

    expect(errs, `console/page errors:\n${errs.join('\n')}`).toEqual([]);
});
