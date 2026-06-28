// @ts-check
const { test, expect } = require('@playwright/test');

// End-to-end integrity test for edit/void → journal correction. Runs as the QA
// Firebase account against real Firestore (rules deployed). Creates a transaction,
// edits its amount, then voids it, asserting the ledger (trial balance) corrects
// itself at each step via reversal + repost. Asserts DELTAS on the expense account
// so it is isolated from any other data in the QA workspace for the month.

test('editing and voiding a transaction corrects the ledger', async ({ page }) => {
    await page.goto('/ledger.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    // Wait until the page has resolved the workspace (so finance reads/writes scope
    // correctly) before driving DataService directly.
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const { periodKey } = await import('/assets/js/accounting-engine.js');
        const app = getApps()[0];
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((res) => {
            const un = onAuthStateChanged(auth, (u) => { if (u) { un(); res(u); } });
        });
        const uid = user.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;
        const pk = periodKey(new Date());
        const ACC = '6100'; // Marketing Expense (category Marketing → 6100)

        const marketing = async () => {
            const tb = await ds.getTrialBalance(uid, { periodKey: pk });
            const row = tb.rows.find((x) => x.account_code === ACC);
            return row ? row.balance : 0; // signed natural balance (debit-positive for expense)
        };

        const before = await marketing();
        const ref = await ds.addTransaction(uid, {
            amount: 100000, vendor_name: 'QA Correction Test', category: 'Marketing',
            type: 'expense', status: 'Completed', icon: '\u{1F4B8}'
        });
        const afterCreate = await marketing();
        await ds.updateTransaction(uid, ref.id, { amount: 250000 }, 'QA edit');
        const afterEdit = await marketing();
        await ds.voidTransaction(uid, ref.id, 'QA void');
        const afterVoid = await marketing();

        return { before, afterCreate, afterEdit, afterVoid, txId: ref.id };
    });

    // Create adds a 100k debit to Marketing.
    expect(r.afterCreate - r.before).toBe(100000);
    // Edit to 250k: reversal (-100k) + repost (+250k) → net +250k over the original baseline.
    expect(r.afterEdit - r.before).toBe(250000);
    // Void: reversal of the 250k → back to baseline.
    expect(r.afterVoid - r.before).toBe(0);
});
