// @ts-check
const { test, expect } = require('@playwright/test');

// Phase 3 vendor→account memory: after a vendor is categorized to an account,
// suggestAccountForEntry pre-fills that account for the same vendor (winning over
// the category default), and the Add Transaction drawer reflects it when the
// vendor is entered. Real Firestore + deployed rules. Seeds the memory via
// learnVendorAccount (no transaction saved), so it does not post to the ledger.

test('Vendor memory: a learned vendor pre-fills its account in the drawer', async ({ page }) => {
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

    const vendor = `QA Memo ${Date.now()}`;

    await page.goto('/ledger.html');
    await page.waitForFunction(() => typeof window.showAddTransactionModal === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof window.FluxyAccountPicker === 'object', null, { timeout: 30000 });

    // Seed the memory (learn) + verify the suggestion resolves to it — 6440 Office
    // Supplies, NOT the Operations category default (6400).
    const seeded = await page.evaluate(async (vendorName) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const auth = getAuth(app);
        for (let i = 0; i < 40 && !auth.currentUser; i++) await new Promise((r) => setTimeout(r, 200));
        const uid = auth.currentUser.uid;
        const ds = new DataService(app);
        ds.setActor(uid);
        const wsId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || uid;
        const learned = await ds.learnVendorAccount(wsId, {
            vendor_name: vendorName, account_code: '6440', account_name: 'Office Supplies', account_type: 'expense'
        });
        // Baseline (no vendor) resolves to the Operations category default 6400;
        // with the vendor it must resolve to the learned 6440.
        const baseline = await ds.suggestAccountForEntry(wsId, { type: 'expense', category: 'Operations' });
        const withVendor = await ds.suggestAccountForEntry(wsId, { type: 'expense', category: 'Operations', vendor_name: vendorName });
        return { learnedId: learned && learned.id, baseline: baseline.code, withVendor: withVendor.code };
    }, vendor);

    expect(seeded.learnedId, 'learnVendorAccount persisted (rules accept source_type vendor)').toBeTruthy();
    expect(seeded.baseline).toBe('6400');   // category default when no vendor memory
    expect(seeded.withVendor).toBe('6440'); // vendor memory wins

    // Drawer: entering the learned vendor pre-fills its account (6440).
    await page.evaluate(() => window.showAddTransactionModal({ context: 'transaction', defaultType: 'expense', defaultCategory: 'Operations' }));
    await expect(page.locator('#tx-account-mount .fluxy-acct-trigger')).toBeVisible({ timeout: 15000 });
    await page.fill('#tx-vendor', vendor);
    await page.locator('#tx-vendor').blur();
    await expect.poll(async () => page.$eval('#tx-account-mount input[name="account_code"]', (el) => el.value), { timeout: 15000 })
        .toBe('6440');

    expect(errs, `console/page errors:\n${errs.join('\n')}`).toEqual([]);
});
