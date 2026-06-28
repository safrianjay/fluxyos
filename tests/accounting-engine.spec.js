const { test, expect } = require('@playwright/test');

// Pure-logic unit test for the accounting kernel posting engine. Mirrors the
// billing-config.spec.js pattern: navigate to any served app page, then import
// the ESM module in the browser and assert against its pure outputs. No
// Firestore, no auth — the engine has no I/O.

test('accounting engine posts a balanced journal for every business event', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/accounting-engine.js');
        const d = new Date('2026-06-15T03:00:00Z');
        const j = (collection, id, document, mappings) => e.buildJournal({ collection, id, document, mappings, date: document.timestamp });
        return {
            expense: j('transactions', 't1', { type: 'expense', amount: 150000, category: 'Marketing', timestamp: d }),
            income: j('transactions', 't2', { type: 'income', amount: 5000000, category: 'Revenue', timestamp: d }),
            fee: j('transactions', 't3', { type: 'fee', amount: 2500, timestamp: d }),
            pendPayable: j('transactions', 't4', { type: 'pending_payable', amount: 99000, category: 'SaaS', timestamp: d }),
            transfer: j('transactions', 't6', { type: 'transfer', amount: 1000, timestamp: d }),
            billAccrue: j('bills', 'b1', { amount: 1200000, category: 'Infrastructure', vendor_name: 'AWS', timestamp: d }),
            billPay: j('transactions', 't7', { type: 'expense', amount: 1200000, linked_bill_id: 'b1', timestamp: d }),
            invIssue: j('invoices', 'i1', { status: 'sent', amount: 7500000, customer_name: 'Acme', timestamp: d }),
            invDraft: j('invoices', 'i2', { status: 'draft', amount: 7500000, timestamp: d }),
            mapped: j('transactions', 't9', { type: 'expense', amount: 5000, category: 'Event' }, { 'category:Event': '6400' }),
            opening: e.buildOpeningJournal({ entries: [{ account_code: '1000', debit: 50000000 }, { account_code: '2000', credit: 8000000 }], date: d }),
            closeProfit: e.buildClosingJournal({ revenueTotal: 5000000, expenseTotal: 1451500, periodKey: '2026-06' }),
            pkJakarta: e.periodKey(new Date('2026-06-30T17:30:00Z')),
            signedAsset: e.signedBalance('asset', 5000, 2000),
            signedLiability: e.signedBalance('liability', 2000, 9000)
        };
    });

    const balanced = (jr) => jr && jr.is_balanced && jr.total_debit === jr.total_credit && jr.total_debit > 0;

    // Every posting event is balanced.
    for (const key of ['expense', 'income', 'fee', 'pendPayable', 'billAccrue', 'billPay', 'invIssue', 'mapped', 'opening', 'closeProfit']) {
        expect(balanced(r[key]), `${key} must be balanced`).toBe(true);
    }
    // Rule selection.
    expect(r.expense.posting_rule_id).toBe('TXN-EXP-CASH');
    expect(r.income.posting_rule_id).toBe('TXN-INC-CASH');
    expect(r.billPay.posting_rule_id).toBe('BILL-PAY'); // linked payment settles A/P, no double expense
    expect(r.invIssue.posting_rule_id).toBe('INV-ISSUE');
    // Non-posting events return null.
    expect(r.transfer).toBeNull();
    expect(r.invDraft).toBeNull();
    // A custom category honors the saved mapping (6400 Operations), not the fallback.
    expect(r.mapped.lines.some((l) => l.account_code === '6400' && l.debit === 5000)).toBe(true);
    // Period key uses Asia/Jakarta — a 17:30 UTC posting on Jun 30 is Jul 1 locally.
    expect(r.pkJakarta).toBe('2026-07');
    // Signed balances follow normal-balance direction.
    expect(r.signedAsset).toBe(3000);
    expect(r.signedLiability).toBe(7000);
});
