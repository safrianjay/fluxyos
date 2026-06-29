// @ts-check
const { test, expect } = require('@playwright/test');

// Marking a bill paid posts a BILL-PAY journal into the PAYMENT-date period. If
// that period is closed, the user must get a clear message — not a raw Firestore
// "permission denied" (which they hit when the current month was closed). Also
// confirms paying into an OPEN period still works. Isolated past period; QA owner.

test('marking a bill paid into a closed period is blocked with a clear message', async ({ page }) => {
    await page.goto('/bill.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { Timestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((res) => { const un = onAuthStateChanged(auth, (u) => { if (u) { un(); res(u); } }); });
        const uid = user.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;
        const PK = '2026-04';

        const p0 = await ds.getPeriod(uid, PK);
        if (p0.status === 'closed' || p0.status === 'locked') { try { await ds.reopenPeriod(uid, PK); } catch (_) {} }

        // A bill due in PK (accrues into PK while it is open).
        const billRef = await ds.addBill(uid, {
            amount: 300000, vendor_name: 'Closed Pay Test', category: 'Operations', type: 'pending_payable',
            status: 'Upcoming', icon: '\u{1F4B8}', timestamp: Timestamp.fromDate(new Date('2026-04-05T03:00:00Z')),
            due_date: Timestamp.fromDate(new Date('2026-04-15T03:00:00Z')), payment_status: 'unpaid'
        });
        await ds.closePeriod(uid, PK);

        // Pay it with a payment date inside the now-closed PK → must be blocked clearly.
        let message = null;
        let isPermission = false;
        try {
            await ds.markBillPaid(uid, billRef.id, { paymentDate: new Date('2026-04-20T03:00:00Z') });
        } catch (e) {
            message = String(e && e.message || e);
            isPermission = e && (e.code === 'permission-denied' || /Missing or insufficient permissions/i.test(message));
        }

        // Reopen, then paying into the now-open period should succeed.
        try { await ds.reopenPeriod(uid, PK); } catch (_) {}
        let paidOk = false;
        try {
            const res = await ds.markBillPaid(uid, billRef.id, { paymentDate: new Date('2026-04-20T03:00:00Z') });
            paidOk = !!(res && res.transactionId);
        } catch (_) { paidOk = false; }

        return { message, isPermission, paidOk };
    });

    expect(r.message, 'paying into a closed period should be rejected').not.toBeNull();
    expect(r.isPermission, `should NOT be a raw permission error — got: ${r.message}`).toBe(false);
    expect(r.message).toMatch(/closed .*period/i);
    expect(r.paidOk, 'paying into an open period should still work').toBe(true);
});

test('marking an invoice paid into a closed period is blocked with a clear message', async ({ page }) => {
    await page.goto('/invoices.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { Timestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((res) => { const un = onAuthStateChanged(auth, (u) => { if (u) { un(); res(u); } }); });
        const uid = user.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;
        const PK = '2026-04';

        const p0 = await ds.getPeriod(uid, PK);
        if (p0.status === 'closed' || p0.status === 'locked') { try { await ds.reopenPeriod(uid, PK); } catch (_) {} }

        const draft = await ds.createInvoiceDraft(uid, {
            customer_name: 'Closed Pay Invoice Test',
            issue_date: Timestamp.fromDate(new Date('2026-04-05T03:00:00Z')),
            due_date: Timestamp.fromDate(new Date('2026-04-15T03:00:00Z')),
            items: [{ description: 'Test service', quantity: 1, unit_price: 300000 }]
        });
        const invoiceId = draft && draft.id ? draft.id : null;
        if (!invoiceId) {
            throw new Error('Invoice draft creation failed');
        }
        await ds.finalizeInvoice(uid, invoiceId);
        await ds.closePeriod(uid, PK);

        let message = null;
        let isPermission = false;
        try {
            await ds.markInvoicePaid(uid, invoiceId, { paymentDate: new Date('2026-04-20T03:00:00Z') });
        } catch (e) {
            message = String(e && e.message || e);
            isPermission = e && (e.code === 'permission-denied' || /Missing or insufficient permissions/i.test(message));
        }

        try { await ds.reopenPeriod(uid, PK); } catch (_) {}
        let paidOk = false;
        try {
            const res = await ds.markInvoicePaid(uid, invoiceId, { paymentDate: new Date('2026-04-20T03:00:00Z') });
            paidOk = !!(res && res.transactionId);
        } catch (_) { paidOk = false; }

        return { message, isPermission, paidOk };
    });

    expect(r.message, 'paying an invoice into a closed period should be rejected').not.toBeNull();
    expect(r.isPermission, `should NOT be a raw permission error — got: ${r.message}`).toBe(false);
    expect(r.message).toMatch(/closed .*period/i);
    expect(r.paidOk, 'paying an invoice into an open period should still work').toBe(true);
});
