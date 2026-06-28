// @ts-check
const { test, expect } = require('@playwright/test');

// End-to-end test for the bulk-import posting sweep. Bulk imports (addTransactions
// = CSV) mark rows accounting_status:'pending' instead of posting inline; the sweep
// (postPendingJournals) posts them later. Verifies: imports don't post inline, the
// sweep posts the backlog into the ledger, and a re-run is idempotent. Runs as the
// QA account against real Firestore.

test('bulk imports defer posting; the sweep posts them once', async ({ page }) => {
    await page.goto('/ledger.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const { periodKey } = await import('/assets/js/accounting-engine.js');
        const app = getApps()[0];
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((res) => { const un = onAuthStateChanged(auth, (u) => { if (u) { un(); res(u); } }); });
        const uid = user.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;
        const pk = periodKey(new Date());
        const EXP = 777111; // Marketing (6100)
        const INC = 888222; // Revenue (4000)

        const bal = async (code) => {
            const tb = await ds.getTrialBalance(uid, { periodKey: pk });
            const row = tb.rows.find((x) => x.account_code === code);
            return row ? row.balance : 0;
        };
        const snap = async () => ({ mkt: await bal('6100'), rev: await bal('4000'), pending: await ds.countPendingPostings(uid) });

        const before = await snap();
        // Simulate a CSV bulk import (these are created pending, not posted inline).
        await ds.addTransactions(uid, [
            { amount: EXP, vendor_name: 'Sweep Test Ads', category: 'Marketing', type: 'expense', status: 'Completed', icon: '\u{1F4B8}' },
            { amount: INC, vendor_name: 'Sweep Test Client', category: 'Revenue', type: 'income', status: 'Completed', icon: '\u{1F4B0}' }
        ]);
        const afterImport = await snap();
        // Sweep posts the backlog.
        const sweep1 = await ds.postPendingJournals(uid);
        const afterSweep = await snap();
        // Idempotent re-run.
        const sweep2 = await ds.postPendingJournals(uid);

        return { before, afterImport, afterSweep, sweep1, sweep2, EXP, INC };
    });

    // Import adds two pending entries and does NOT touch the ledger.
    expect(r.afterImport.pending - r.before.pending).toBe(2);
    expect(r.afterImport.mkt).toBe(r.before.mkt);
    expect(r.afterImport.rev).toBe(r.before.rev);
    // Sweep posts at least our two and moves them into the ledger.
    expect(r.sweep1.posted).toBeGreaterThanOrEqual(2);
    expect(r.afterSweep.mkt - r.before.mkt).toBeGreaterThanOrEqual(r.EXP);
    expect(r.afterSweep.rev - r.before.rev).toBeGreaterThanOrEqual(r.INC);
    // Backlog cleared (our two are posted) and the re-run posts nothing.
    expect(r.afterSweep.pending).toBeLessThan(r.afterImport.pending);
    expect(r.sweep2.posted).toBe(0);
});
