// @ts-check
const { test, expect } = require('@playwright/test');

// Cash application (Phase 2): partial + combined invoice payments. Mirrors
// accounting-invoice.spec.js — real Firestore, rules deployed, asserted on ledger
// DELTAS (A/R 1100, Revenue 4000, Cash 1000) so it is isolated from other data in
// the QA workspace. Each partial posts INV-PAY (Dr Cash / Cr A/R) drawing down the
// INV-ISSUE receivable; receiveCustomerPayment applies one payment across invoices.

test('invoices: partial payments draw down A/R, combine across invoices, and guard foreign', async ({ page }) => {
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
        const draft = (n, price, currency) => ({ customer_name: n, currency: currency || 'IDR', due_date: due, items: [{ description: 'Consulting', quantity: 1, unit_price: price }] });

        // --- Partial flow: 1,000,000 paid as 400,000 then 600,000 ---
        const base = await snapshot();
        const inv = await ds.createInvoiceDraft(uid, draft('QA Inv Partial', 1000000));
        await ds.finalizeInvoice(uid, inv.id, {});
        const afterIssue = await snapshot();

        await ds.recordInvoicePayment(uid, inv.id, { amount: 400000 });
        const invAfter1 = await ds.getInvoice(uid, inv.id);
        const afterP1 = await snapshot();

        // Over-pay guard on the partial (remaining 600,000).
        let overErr = null;
        try { await ds.recordInvoicePayment(uid, inv.id, { amount: 99999999 }); } catch (e) { overErr = e && e.message; }

        await ds.recordInvoicePayment(uid, inv.id, { amount: 600000 });
        const invAfter2 = await ds.getInvoice(uid, inv.id);
        const afterP2 = await snapshot();

        // --- Combined flow: two invoices for one customer, settled in one action ---
        const cBase = await snapshot();
        const a = await ds.createInvoiceDraft(uid, draft('QA Combine', 500000));
        await ds.finalizeInvoice(uid, a.id, {});
        const b = await ds.createInvoiceDraft(uid, draft('QA Combine', 300000));
        await ds.finalizeInvoice(uid, b.id, {});
        const cAfterIssue = await snapshot();
        const combined = await ds.receiveCustomerPayment(uid, [{ invoiceId: a.id }, { invoiceId: b.id }]);
        const aAfter = await ds.getInvoice(uid, a.id);
        const bAfter = await ds.getInvoice(uid, b.id);
        const cAfterPay = await snapshot();

        // --- Foreign guard: a USD invoice is full-payment-only ---
        let foreignErr = null;
        const usd = await ds.createInvoiceDraft(uid, draft('QA USD', 10000, 'USD'));
        await ds.finalizeInvoice(uid, usd.id, {});
        try { await ds.recordInvoicePayment(uid, usd.id, { amount: 5000 }); } catch (e) { foreignErr = e && e.message; }

        return {
            issueAr: afterIssue.ar - base.ar,
            p1Status: invAfter1.status, p1Outstanding: invAfter1.outstanding_amount, p1Paid: invAfter1.amount_paid,
            p1Ar: afterP1.ar - base.ar, p1Cash: afterP1.cash - base.cash,
            overErr,
            p2Status: invAfter2.status, p2Outstanding: invAfter2.outstanding_amount, p2Paid: invAfter2.amount_paid,
            p2Ar: afterP2.ar - base.ar, p2Cash: afterP2.cash - base.cash, p2Rev: afterP2.rev - afterIssue.rev,
            cIssueAr: cAfterIssue.ar - cBase.ar,
            combinedPaid: combined.paidCount, combinedApplied: combined.totalApplied,
            aStatus: aAfter.status, bStatus: bAfter.status,
            cPayAr: cAfterPay.ar - cBase.ar, cPayCash: cAfterPay.cash - cBase.cash,
            foreignErr
        };
    });

    // Issue posted the full receivable.
    expect(r.issueAr).toBe(1000000);
    // First partial: invoice partial, A/R down 400k, Cash up 400k.
    expect(r.p1Status).toBe('partial');
    expect(r.p1Outstanding).toBe(600000);
    expect(r.p1Paid).toBe(400000);
    expect(r.p1Ar).toBe(600000);
    expect(r.p1Cash).toBe(400000);
    // Over-pay is rejected.
    expect(r.overErr).toMatch(/exceed/i);
    // Second partial clears it: paid, A/R back to baseline, Cash +1M total, Revenue unchanged.
    expect(r.p2Status).toBe('paid');
    expect(r.p2Outstanding).toBe(0);
    expect(r.p2Paid).toBe(1000000);
    expect(r.p2Ar).toBe(0);
    expect(r.p2Cash).toBe(1000000);
    expect(r.p2Rev).toBe(0);
    // Combined: two invoices issued (+800k A/R) then settled together (back to 0).
    expect(r.cIssueAr).toBe(800000);
    expect(r.combinedPaid).toBe(2);
    expect(r.combinedApplied).toBe(800000);
    expect(r.aStatus).toBe('paid');
    expect(r.bStatus).toBe('paid');
    expect(r.cPayAr).toBe(0);
    expect(r.cPayCash).toBe(800000);
    // A foreign-currency invoice refuses a partial payment.
    expect(r.foreignErr).toMatch(/foreign-currency/i);
});
