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
