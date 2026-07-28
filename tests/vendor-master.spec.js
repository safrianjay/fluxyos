// @ts-check
const { test, expect } = require('@playwright/test');

// Vendor master (Part A): a vendor entity with a default account pre-fills that
// account for its bills/transactions — winning over the category default and
// tagged source 'vendor_default'. Real Firestore + deployed rules. Creates a
// vendor via addVendor, then archives it (cleanup). No transaction saved.

test('Vendor master: a vendor default account pre-fills in the drawer', async ({ page }) => {
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

    const vendor = `QA VMaster ${Date.now()}`;

    await page.goto('/ledger.html');
    await page.waitForFunction(() => typeof window.showAddTransactionModal === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof window.FluxyAccountPicker === 'object', null, { timeout: 30000 });

    const r = await page.evaluate(async (vendorName) => {
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
        const created = await ds.addVendor(wsId, {
            name: vendorName, default_account_code: '6440', default_currency: 'USD', payment_terms: 'due_in_30_days'
        });
        const withVendor = await ds.suggestAccountForEntry(wsId, { type: 'expense', category: 'Operations', vendor_name: vendorName });
        const baseline = await ds.suggestAccountForEntry(wsId, { type: 'expense', category: 'Operations', vendor_name: 'Nobody Special' });
        const found = await ds.getVendorByKey(wsId, vendorName);
        return { id: created && created.id, withCode: withVendor.code, withSource: withVendor.source, baseline: baseline.code, foundCurrency: found && found.default_currency };
    }, vendor);

    expect(r.id, 'addVendor persisted (rules accept the vendors collection)').toBeTruthy();
    expect(r.foundCurrency).toBe('USD');
    expect(r.baseline).toBe('6400');       // category default with no vendor entity
    expect(r.withCode).toBe('6440');       // vendor default wins
    expect(r.withSource).toBe('vendor_default');

    // Drawer: the vendor's name pre-fills its default account (6440).
    await page.evaluate(() => window.showAddTransactionModal({ context: 'transaction', defaultType: 'expense', defaultCategory: 'Operations' }));
    await expect(page.locator('#tx-account-mount .fluxy-acct-trigger')).toBeVisible({ timeout: 15000 });
    await page.fill('#tx-vendor', vendor);
    await page.locator('#tx-vendor').blur();
    await expect.poll(async () => page.$eval('#tx-account-mount input[name="account_code"]', (el) => el.value), { timeout: 15000 })
        .toBe('6440');

    // Clean up: archive the vendor.
    await page.evaluate(async (id) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        const wsId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || uid;
        await ds.archiveVendor(wsId, id);
    }, r.id);

    expect(errs, `console/page errors:\n${errs.join('\n')}`).toEqual([]);
});
