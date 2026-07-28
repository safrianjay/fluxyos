// @ts-check
const { test, expect } = require('@playwright/test');

// Stage B: a foreign-currency (USD) bill stays OUTSIDE the IDR kernel — no accrual
// journal at creation (accounting_status 'excluded'), amounts in minor units (cents)
// — and on payment the caller-supplied Rupiah amount is what posts, with the FX
// provenance stamped on the bill and the payment transaction kept out of the
// journals. Real Firestore + deployed rules; exercises the DAL directly.

test('Bill multi-currency: a USD bill is excluded from the kernel and converts to IDR on payment', async ({ page }) => {
    await page.goto('/bill.html');
    await page.waitForFunction(() => !!(window.__fluxyBillsContext && window.__fluxyBillsContext.auth && window.__fluxyBillsContext.auth.currentUser), null, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const ds = window.__fluxyBillsContext.ds;
        const uid = window.__fluxyBillsContext.auth.currentUser.uid;
        const wsId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || uid;
        ds.setActor(uid);

        // Create a USD bill for $1,500.00 (150000 cents).
        const ref = await ds.addBill(wsId, {
            amount: 150000, currency: 'USD', vendor_name: `QA FX ${Date.now()}`,
            category: 'Infrastructure', type: 'expense', status: 'Upcoming', icon: '💸',
            payment_status: 'unpaid', due_date: new Date(Date.now() + 7 * 86400000)
        });
        const billId = ref.id;
        const created = await ds.getBillById(wsId, billId);

        // No accrual journal for a foreign bill.
        const js1 = await ds.listJournals(wsId, { max: 50 });
        const accrual = js1.find((j) => j.source && j.source.collection === 'bills' && j.source.id === billId) || null;

        // Pay it: user supplies the Rupiah amount actually paid + the rate.
        const pay = await ds.markBillPaid(wsId, billId, {
            amountPaidIdr: 23000000, fxRate: 15333.33, fxRateDate: '2026-07-28'
        });
        const paid = await ds.getBillById(wsId, billId);
        const payTx = pay && pay.transactionId ? await ds.getTransactionById(wsId, pay.transactionId).catch(() => null) : null;
        const js2 = await ds.listJournals(wsId, { max: 50 });
        const payJournal = payTx ? (js2.find((j) => j.source && j.source.id === pay.transactionId) || null) : null;

        return {
            createdCurrency: created.currency,
            createdStatus: created.accounting_status,
            createdOutstanding: created.outstanding_amount,
            hadAccrualJournal: !!accrual,
            paidStatus: paid.payment_status,
            paidOutstanding: paid.outstanding_amount,
            amountPaidIdr: paid.amount_paid_idr,
            fxRate: paid.fx_rate,
            fxRateDate: paid.fx_rate_date,
            payTxAmount: payTx && payTx.amount,
            payTxAccounting: payTx && payTx.accounting_status,
            hadPayJournal: !!payJournal
        };
    });

    // Creation: USD, excluded from the kernel, minor-unit outstanding, no journal.
    expect(r.createdCurrency).toBe('USD');
    expect(r.createdStatus).toBe('excluded');
    expect(r.createdOutstanding).toBe(150000);
    expect(r.hadAccrualJournal).toBe(false);

    // Payment: Rupiah posted, FX stamped, no journal, cleared.
    expect(r.paidStatus).toBe('paid');
    expect(r.paidOutstanding).toBe(0);
    expect(r.amountPaidIdr).toBe(23000000);
    expect(Math.round(r.fxRate)).toBe(15333);
    expect(r.fxRateDate).toBe('2026-07-28');
    expect(r.payTxAmount).toBe(23000000);       // the ledger records the Rupiah paid
    expect(r.payTxAccounting).toBe('excluded');  // kept out of the IDR journals
    expect(r.hadPayJournal).toBe(false);
});

test('Bill multi-currency: a USD bill can be paid in partial foreign amounts', async ({ page }) => {
    await page.goto('/bill.html');
    await page.waitForFunction(() => !!(window.__fluxyBillsContext && window.__fluxyBillsContext.auth && window.__fluxyBillsContext.auth.currentUser), null, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const ds = window.__fluxyBillsContext.ds;
        const uid = window.__fluxyBillsContext.auth.currentUser.uid;
        const wsId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || uid;
        ds.setActor(uid);
        // $1,500.00 (150000 cents).
        const ref = await ds.addBill(wsId, {
            amount: 150000, currency: 'USD', vendor_name: `QA FX partial ${Date.now()}`,
            category: 'Infrastructure', type: 'expense', status: 'Upcoming', icon: '💸',
            payment_status: 'unpaid', due_date: new Date(Date.now() + 7 * 86400000)
        });
        const billId = ref.id;
        // Partial 1: pay $500 (50000 cents) for Rp7.000.000.
        await ds.markBillPaid(wsId, billId, { foreignAmount: 50000, amountPaidIdr: 7000000, fxRate: 14000, fxRateDate: '2026-07-28' });
        const afterFirst = await ds.getBillById(wsId, billId);
        // Partial 2: pay the remaining $1,000 (100000 cents) for Rp15.000.000.
        await ds.markBillPaid(wsId, billId, { foreignAmount: 100000, amountPaidIdr: 15000000, fxRate: 15000, fxRateDate: '2026-07-28' });
        const afterSecond = await ds.getBillById(wsId, billId);
        return {
            firstStatus: afterFirst.payment_status,
            firstOutstanding: afterFirst.outstanding_amount,
            firstPaidIdr: afterFirst.amount_paid_idr,
            secondStatus: afterSecond.payment_status,
            secondOutstanding: afterSecond.outstanding_amount,
            secondPaid: afterSecond.amount_paid,
            secondPaidIdr: afterSecond.amount_paid_idr
        };
    });

    // First partial: still owed, foreign outstanding reduced, IDR accrued.
    expect(r.firstStatus).toBe('partial');
    expect(r.firstOutstanding).toBe(100000);
    expect(r.firstPaidIdr).toBe(7000000);
    // Second partial clears it; Rupiah paid accumulates across the two rates.
    expect(r.secondStatus).toBe('paid');
    expect(r.secondOutstanding).toBe(0);
    expect(r.secondPaid).toBe(150000);
    expect(r.secondPaidIdr).toBe(22000000); // 7.000.000 + 15.000.000
});
