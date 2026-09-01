const { test, expect } = require('@playwright/test');

// =============================================================================
// A bill for a delivery must CLEAR the liability, not book a second expense.
//
// THE DEFECT THIS CLOSES. `selectRule` has always routed a bill carrying
// `goods_receipt_id` to BILL-GRNI — Dr 2050 / Cr 2000 — instead of BILL-ACCRUE,
// which debits an expense account. But nothing in the codebase ever SET that
// field, so the branch was unreachable and every bill for received goods booked
// the cost a second time: once as an expense when the bill posted, and again as
// COGS when the stock sold. 2050 Goods Received Not Invoiced could only grow.
//
// Measured on the QA workspace on 2026-09-02, before the fix:
//
//     goods receipts            100
//     ...ever matched to a bill   0
//     bills                     441
//     ...linked to a receipt      0
//     2050 GRNI          Rp68.492.000  (credit)
//     1200 + 5100        Rp69.041.800  — i.e. every rupiah ever received
//
// Nothing errored. The books simply carried a phantom liability and an inflated
// cost base, and the Dashboard's OpEx counted stock purchases that should never
// have reached it — OpEx sums `transactions` of type expense/fee/tax, and paying
// a BILL-ACCRUE bill writes exactly that (bills.md, "Mark as paid → Ledger").
//
// Every assertion below is about the JOURNAL, because the journal is the thing
// that was wrong. A spec that only checked the field was set would pass on a
// bill that still posted an expense.
// =============================================================================

test.describe.configure({ timeout: 240_000 });

async function openApp(page) {
    await page.goto('/inventory.html');
    await page.waitForSelector('#inventory-body [data-item-id]', { state: 'attached', timeout: 40000 });
}

// Build a receipt + a bill against it through the DAL, and hand back the
// journal the bill produced.
async function receiveThenBill(page, { link }) {
    return page.evaluate(async (shouldLink) => {
        const mod = await import('/assets/js/db-service.js');
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const ds = new mod.default(getApps()[0]);
        const uid = getAuth(getApps()[0]).currentUser.uid;

        const stamp = Date.now();
        const item = await ds.saveItem(uid, {
            name: `QA GRNI Item ${stamp}`, type: 'stock', base_unit: 'pcs'
        }, { create: true });

        const receipt = await ds.createGoodsReceipt(uid, {
            vendor_name: `QA GRNI Vendor ${stamp}`,
            reference: `QA-GR-${stamp}`,
            lines: [{ item_id: item.id, item_name: item.name, base_unit: 'pcs', quantity: 10, amount: 500000 }]
        });

        // The bill's own required shape comes from bills.md §4b: amount, vendor,
        // category, type, status, icon, due_date, payment_status.
        const bill = await ds.addBill(uid, {
            amount: 500000,
            vendor_name: `QA GRNI Vendor ${stamp}`,
            category: 'Operations',
            type: 'expense',
            status: 'Completed',
            icon: '\u{1F4E6}',
            due_date: new Date(),
            payment_status: 'unpaid',
            ...(shouldLink ? { goods_receipt_id: receipt.id } : {})
        });

        const billDoc = await ds.getBillById(uid, bill.id);
        const receiptAfter = (await ds.getGoodsReceipts(uid, { limitCount: 50 }))
            .find((r) => r.id === receipt.id);
        const journal = billDoc && billDoc.journal_ref
            ? await ds.getJournalById(uid, billDoc.journal_ref).catch(() => null)
            : null;

        return {
            billId: bill.id,
            receiptId: receipt.id,
            linked: (billDoc && billDoc.goods_receipt_id) || null,
            receiptStatus: receiptAfter ? receiptAfter.status : null,
            receiptBillId: receiptAfter ? (receiptAfter.bill_id || null) : null,
            journalLines: journal ? (journal.lines || []).map((l) => ({
                code: String(l.account_code),
                debit: Number(l.debit) || 0,
                credit: Number(l.credit) || 0
            })) : null
        };
    }, link);
}

test('a bill LINKED to a delivery clears GRNI instead of expensing it again', async ({ page }) => {
    await openApp(page);
    const r = await receiveThenBill(page, { link: true });

    // The field survived the write. It could not before: `bills` has a `hasOnly`
    // in firestore.rules and this key was not in it, so the whole document was
    // refused — and rules are a separate deploy from `git push`.
    expect(r.linked, 'the receipt link did not persist — are the rules deployed?').toBe(r.receiptId);

    // THE ASSERTION THAT MATTERS. Dr 2050 GRNI / Cr 2000 A/P: the liability the
    // receipt raised is settled and replaced by one owed to the supplier. No
    // expense account is touched, because the cost is already sitting in 1200 as
    // stock and becomes an expense when that stock sells.
    expect(r.journalLines, 'the bill posted no journal at all').toBeTruthy();
    const debits = r.journalLines.filter((l) => l.debit > 0).map((l) => l.code);
    const credits = r.journalLines.filter((l) => l.credit > 0).map((l) => l.code);
    expect(debits, 'a linked bill must debit 2050 GRNI').toContain('2050');
    expect(credits, 'a linked bill must credit 2000 A/P').toContain('2000');
    // No 5xxx/6xxx expense line anywhere — that is the double count.
    expect(debits.filter((c) => /^[56]/.test(c)),
        'a linked bill debited an expense account — the cost is now counted twice').toEqual([]);

    // The delivery is stamped, so it cannot be offered to a second invoice.
    expect(r.receiptStatus).toBe('billed');
    expect(r.receiptBillId).toBe(r.billId);
});

test('an UNLINKED bill still accrues an expense — the behaviour real expenses need', async ({ page }) => {
    // The control. Rent, software, a courier: these are genuine expenses and must
    // keep debiting one. If this ever posted to 2050, every ordinary bill would
    // start clearing a liability nobody raised.
    await openApp(page);
    const r = await receiveThenBill(page, { link: false });

    expect(r.linked).toBeNull();
    const debits = r.journalLines.filter((l) => l.debit > 0).map((l) => l.code);
    expect(debits.some((c) => /^[56]/.test(c)),
        'an unlinked bill must still debit an expense account').toBe(true);
    expect(debits, 'an unlinked bill must not touch GRNI').not.toContain('2050');
    // …and the delivery it was NOT linked to stays open, still owed.
    expect(r.receiptStatus).toBe('received');
});

test('a delivery cannot be invoiced twice', async ({ page }) => {
    // Two bills clearing one receipt would settle GRNI twice and understate what
    // is owed. Refused with a sentence rather than by a rules denial, because the
    // person doing it is looking at a list of deliveries and needs to know which.
    await openApp(page);
    const outcome = await page.evaluate(async () => {
        const mod = await import('/assets/js/db-service.js');
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const ds = new mod.default(getApps()[0]);
        const uid = getAuth(getApps()[0]).currentUser.uid;
        const stamp = Date.now();
        const item = await ds.saveItem(uid, {
            name: `QA GRNI Twice ${stamp}`, type: 'stock', base_unit: 'pcs'
        }, { create: true });
        const receipt = await ds.createGoodsReceipt(uid, {
            vendor_name: `QA Twice ${stamp}`,
            lines: [{ item_id: item.id, item_name: item.name, base_unit: 'pcs', quantity: 1, amount: 100000 }]
        });
        const base = {
            amount: 100000, vendor_name: `QA Twice ${stamp}`, category: 'Operations',
            type: 'expense', status: 'Completed', icon: '\u{1F4E6}',
            due_date: new Date(), payment_status: 'unpaid',
            goods_receipt_id: receipt.id
        };
        await ds.addBill(uid, base);
        try { await ds.addBill(uid, base); return { second: 'ALLOWED' }; }
        catch (e) { return { second: 'REFUSED', message: e.message }; }
    });

    expect(outcome.second, 'a second bill was allowed to clear the same delivery').toBe('REFUSED');
    expect(outcome.message).toMatch(/already been invoiced/i);
});

test('the open-deliveries list is what the bill drawer offers', async ({ page }) => {
    // `getOpenGoodsReceipts` is the picker's source. A receipt leaves it only by
    // being invoiced — never on a timer, because GRNI is a real liability until
    // the invoice arrives and an old delivery is exactly the one somebody is
    // looking for.
    await openApp(page);
    const shape = await page.evaluate(async () => {
        const mod = await import('/assets/js/db-service.js');
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const ds = new mod.default(getApps()[0]);
        const uid = getAuth(getApps()[0]).currentUser.uid;
        const open = await ds.getOpenGoodsReceipts(uid);
        return {
            count: open.length,
            allReceived: open.every((r) => r.status === 'received'),
            noneBilled: open.every((r) => !r.bill_id)
        };
    });
    expect(shape.allReceived, 'a billed or reversed receipt was offered for invoicing').toBe(true);
    expect(shape.noneBilled, 'a receipt that already has a bill was offered again').toBe(true);
});
