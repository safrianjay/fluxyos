// @ts-check
const { test, expect } = require('@playwright/test');

// Vendor master → Add Bill: entering a known vendor in the Add Bill drawer
// prefills the bill's currency from the vendor's default (and its account from the
// vendor default). Real Firestore + deployed rules. Seeds a USD vendor via
// addVendor, then archives it (cleanup). No bill saved.

test('Add Bill: a known vendor prefills its default currency + account', async ({ page }) => {
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

    const vendor = `QA VBill ${Date.now()}`;

    await page.goto('/bill.html');
    await page.waitForFunction(() => typeof window.showAddTransactionModal === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof window.FluxyAccountPicker === 'object', null, { timeout: 30000 });
    await page.waitForFunction(() => !!(window.__fluxyBillsContext && window.__fluxyBillsContext.auth && window.__fluxyBillsContext.auth.currentUser), null, { timeout: 30000 });

    // Seed a USD vendor whose default account is 6440.
    const vendorId = await page.evaluate(async (vendorName) => {
        const ds = window.__fluxyBillsContext.ds;
        const uid = window.__fluxyBillsContext.auth.currentUser.uid;
        const wsId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || uid;
        ds.setActor(uid);
        const v = await ds.addVendor(wsId, {
            name: vendorName, default_account_code: '6440', default_currency: 'USD', payment_terms: 'due_in_30_days'
        });
        return v && v.id;
    }, vendor);
    expect(vendorId).toBeTruthy();

    // Open the Add Bill drawer and enter the vendor.
    await page.evaluate(() => window.showAddTransactionModal({ context: 'bill', title: 'Add New Bill', submitLabel: 'Save Bill', defaultCategory: 'Operations' }));
    await expect(page.locator('#tx-currency')).toBeAttached({ timeout: 15000 });
    await page.fill('#tx-vendor', vendor);
    await page.locator('#tx-vendor').blur();

    // Currency prefills to USD (and the amount label follows); account → 6440.
    await expect.poll(async () => page.$eval('#tx-currency', (el) => el.value), { timeout: 15000 }).toBe('USD');
    await expect(page.locator('#tx-amount-cur')).toContainText('USD');
    await expect.poll(async () => page.$eval('#tx-account-mount input[name="account_code"]', (el) => el.value), { timeout: 15000 }).toBe('6440');

    // Clean up.
    await page.evaluate(async (id) => {
        const ds = window.__fluxyBillsContext.ds;
        const uid = window.__fluxyBillsContext.auth.currentUser.uid;
        const wsId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || uid;
        await ds.archiveVendor(wsId, id);
    }, vendorId);

    expect(errs, `console/page errors:\n${errs.join('\n')}`).toEqual([]);
});
