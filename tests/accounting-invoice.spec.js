// @ts-check
const { test, expect } = require('@playwright/test');

// End-to-end test for invoice posting (INV-ISSUE / INV-PAY / void reversal).
// Runs as the QA account against real Firestore (rules deployed). Asserts ledger
// DELTAS on Accounts Receivable (1100), Revenue (4000), and Cash (1000) so it is
// isolated from any other data in the QA workspace for the month.

test('invoices post on issue, settle on payment, and reverse on void', async ({ page }) => {
    await page.goto('/invoices.html');
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

        const bal = async (code) => {
            const tb = await ds.getTrialBalance(uid, { periodKey: pk });
            const row = tb.rows.find((x) => x.account_code === code);
            return row ? row.balance : 0;
        };
        const snapshot = async () => ({ ar: await bal('1100'), rev: await bal('4000'), cash: await bal('1000') });
        const due = new Date(Date.now() + 30 * 86400000).toISOString();
        const draft = (n) => ({ customer_name: n, due_date: due, items: [{ description: 'Consulting', quantity: 1, unit_price: 1000000 }] });

        const base = await snapshot();
        // Issue → INV-ISSUE (Dr A/R / Cr Revenue).
        const inv1 = await ds.createInvoiceDraft(uid, draft('QA Invoice Pay'));
        await ds.finalizeInvoice(uid, inv1.id, {});
        const afterIssue = await snapshot();
        // Pay → INV-PAY (Dr Cash / Cr A/R).
        await ds.markInvoicePaid(uid, inv1.id, {});
        const afterPay = await snapshot();

        // Void path on a second invoice.
        const base2 = await snapshot();
        const inv2 = await ds.createInvoiceDraft(uid, draft('QA Invoice Void'));
        await ds.finalizeInvoice(uid, inv2.id, {});
        const afterIssue2 = await snapshot();
        await ds.voidInvoice(uid, inv2.id, 'QA void test');
        const afterVoid = await snapshot();

        return { base, afterIssue, afterPay, base2, afterIssue2, afterVoid };
    });

    // Issue: A/R +1M, Revenue +1M.
    expect(r.afterIssue.ar - r.base.ar).toBe(1000000);
    expect(r.afterIssue.rev - r.base.rev).toBe(1000000);
    // Pay: A/R settles back to baseline, Cash +1M, Revenue unchanged from issue.
    expect(r.afterPay.ar - r.base.ar).toBe(0);
    expect(r.afterPay.cash - r.base.cash).toBe(1000000);
    expect(r.afterPay.rev - r.afterIssue.rev).toBe(0);
    // Void: issue then reverse → A/R and Revenue back to baseline.
    expect(r.afterIssue2.ar - r.base2.ar).toBe(1000000);
    expect(r.afterVoid.ar - r.base2.ar).toBe(0);
    expect(r.afterVoid.rev - r.base2.rev).toBe(0);
});
