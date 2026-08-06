// @ts-check
const { test, expect } = require('@playwright/test');

// The single-bill "Record payment" modal can settle PART of a balance.
// Previously it always paid the whole thing: _payBillOnce accepted a partial
// amount and the vendor "Pay Bills" modal used it, but markBillPaid pinned the
// figure to the full outstanding balance, so the drawer had no way to ask.

test('Record payment settles a partial amount and leaves the bill open', async ({ page }) => {
    await page.goto('/bill.html');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { Timestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((res) => {
            const un = onAuthStateChanged(auth, (u) => { if (u) { un(); res(u); } });
        });
        const uid = user.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;

        const day = (d) => Timestamp.fromDate(new Date(`2026-08-${d}T03:00:00Z`));
        const billRef = await ds.addBill(uid, {
            amount: 10000000, vendor_name: `Partial Pay ${Date.now()}`, category: 'Operations',
            type: 'pending_payable', status: 'Upcoming', icon: '\u{1F4B8}',
            timestamp: day('03'), due_date: day('15'), payment_status: 'unpaid'
        });

        const out = {};
        // Pay a quarter of it.
        await ds.markBillPaid(uid, billRef.id, { paymentDate: new Date('2026-08-06T03:00:00Z'), payAmount: 2500000 });
        let bill = await ds.getBillById(uid, billRef.id);
        out.afterPartial = {
            status: bill.payment_status,
            paid: bill.amount_paid,
            outstanding: bill.outstanding_amount,
            // A partial must NOT convert the budget commitment or stamp the
            // deep-link — the bill is still owed.
            impact: bill.budget_impact_status || null,
            linked: bill.linked_transaction_id || null
        };

        // Over-paying the remainder is refused by the data layer.
        try {
            await ds.markBillPaid(uid, billRef.id, { paymentDate: new Date('2026-08-06T03:00:00Z'), payAmount: 999999999 });
            out.overpayBlocked = false;
        } catch (e) { out.overpayBlocked = /exceed/i.test(String(e.message)); }

        // Settle the rest; now it is genuinely paid.
        await ds.markBillPaid(uid, billRef.id, { paymentDate: new Date('2026-08-06T03:00:00Z'), payAmount: 7500000 });
        bill = await ds.getBillById(uid, billRef.id);
        out.afterFull = {
            status: bill.payment_status,
            paid: bill.amount_paid,
            outstanding: bill.outstanding_amount,
            impact: bill.budget_impact_status || null,
            linked: !!bill.linked_transaction_id
        };

        // Omitting payAmount still settles everything — every existing caller
        // relies on that.
        const bill2 = await ds.addBill(uid, {
            amount: 4000000, vendor_name: `Full Pay ${Date.now()}`, category: 'Operations',
            type: 'pending_payable', status: 'Upcoming', icon: '\u{1F4B8}',
            timestamp: day('03'), due_date: day('15'), payment_status: 'unpaid'
        });
        await ds.markBillPaid(uid, bill2.id, { paymentDate: new Date('2026-08-06T03:00:00Z') });
        const full = await ds.getBillById(uid, bill2.id);
        out.defaultsToFull = { status: full.payment_status, outstanding: full.outstanding_amount };
        return out;
    });

    expect(r.afterPartial.status).toBe('partial');
    expect(r.afterPartial.paid).toBe(2500000);
    expect(r.afterPartial.outstanding).toBe(7500000);
    expect(r.afterPartial.impact).not.toBe('converted_to_actual');
    expect(r.afterPartial.linked).toBeNull();

    expect(r.overpayBlocked).toBe(true);

    expect(r.afterFull.status).toBe('paid');
    expect(r.afterFull.paid).toBe(10000000);
    expect(r.afterFull.outstanding).toBe(0);
    expect(r.afterFull.impact).toBe('converted_to_actual');
    expect(r.afterFull.linked).toBe(true);

    expect(r.defaultsToFull.status).toBe('paid');
    expect(r.defaultsToFull.outstanding).toBe(0);
});

test('the pay modal exposes an amount field that drives the button label', async ({ page }) => {
    await page.goto('/bill.html');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    // Seed an unpaid bill so this never skips for want of fixture data — the
    // assertions below are the only coverage the new field has.
    const vendor = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { Timestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app); ds.actorUid = uid;
        const name = `Modal Partial ${Date.now()}`;
        await ds.addBill(uid, {
            amount: 5000000, vendor_name: name, category: 'Operations',
            type: 'pending_payable', status: 'Upcoming', icon: '\u{1F4B8}',
            timestamp: Timestamp.fromDate(new Date('2026-08-03T03:00:00Z')),
            due_date: Timestamp.fromDate(new Date('2026-08-15T03:00:00Z')),
            payment_status: 'unpaid'
        });
        return name;
    });

    await page.reload();
    await page.waitForTimeout(2500);
    await page.locator(`tr:has-text("${vendor}") [data-action="review"], [data-action="review"]`).first().click();
    await page.locator('#bill-mark-paid-btn').click();

    const amount = page.locator('#bill-pay-amount');
    await expect(amount).toBeVisible();
    // Pre-filled with the full balance → the button offers to close the bill.
    await expect(page.locator('#bill-pay-confirm')).toHaveText('Mark as Paid');

    // A smaller figure leaves the bill open, and the button must say so rather
    // than promising the bill is settled.
    await amount.fill('');
    await amount.type('1000');
    await expect(page.locator('#bill-pay-confirm')).toHaveText('Record payment');
    // Live thousands separators apply here too.
    await expect(amount).toHaveValue('1.000');
});
