// @ts-check
const { test, expect } = require('@playwright/test');

// Phase 3b keyword→account rules: a rule "when the vendor/description contains
// <keyword>, use <account>" pre-fills that account in the Add Transaction drawer
// (winning over the category default), when direction-compatible. Real Firestore
// + deployed rules. Seeds the rule via saveKeywordAccountRule (no transaction
// saved). Uses a unique keyword so the substring match is deterministic.

test('Keyword rule: a matching vendor pre-fills the rule account in the drawer', async ({ page }) => {
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

    const token = `kw${Date.now()}`;
    const vendorWithKeyword = `Ride ${token} trip`;   // contains the keyword as a substring

    await page.goto('/ledger.html');
    await page.waitForFunction(() => typeof window.showAddTransactionModal === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof window.FluxyAccountPicker === 'object', null, { timeout: 30000 });

    const seeded = await page.evaluate(async ({ tok, vendor }) => {
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
        const saved = await ds.saveKeywordAccountRule(wsId, { keyword: tok, account_code: '6440' });
        // A vendor CONTAINING the keyword resolves to 6440; a vendor without it
        // falls back to the Operations category default (6400).
        const withKw = await ds.suggestAccountForEntry(wsId, { type: 'expense', category: 'Operations', vendor_name: vendor });
        const without = await ds.suggestAccountForEntry(wsId, { type: 'expense', category: 'Operations', vendor_name: 'Some Other Vendor' });
        const listed = await ds.listKeywordAccountRules(wsId);
        return { savedId: saved && saved.id, withKw: withKw.code, without: without.code, hasRule: listed.some((r) => r.keyword === tok) };
    }, { tok: token, vendor: vendorWithKeyword });

    expect(seeded.savedId, 'saveKeywordAccountRule persisted (rules accept source_type keyword)').toBeTruthy();
    expect(seeded.hasRule).toBe(true);
    expect(seeded.without).toBe('6400');  // category default when no keyword matches
    expect(seeded.withKw).toBe('6440');   // keyword rule wins

    // Drawer: a vendor containing the keyword pre-fills 6440.
    await page.evaluate(() => window.showAddTransactionModal({ context: 'transaction', defaultType: 'expense', defaultCategory: 'Operations' }));
    await expect(page.locator('#tx-account-mount .fluxy-acct-trigger')).toBeVisible({ timeout: 15000 });
    await page.fill('#tx-vendor', vendorWithKeyword);
    await page.locator('#tx-vendor').blur();
    await expect.poll(async () => page.$eval('#tx-account-mount input[name="account_code"]', (el) => el.value), { timeout: 15000 })
        .toBe('6440');

    // Clean up: archive the rule so it doesn't linger in the QA workspace.
    await page.evaluate(async (tok) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        const wsId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || uid;
        await ds.archiveKeywordAccountRule(wsId, tok);
    }, token);

    expect(errs, `console/page errors:\n${errs.join('\n')}`).toEqual([]);
});
