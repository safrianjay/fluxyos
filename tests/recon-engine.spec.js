const { test, expect } = require('@playwright/test');

// Pure-logic unit tests for the bank reconciliation matching engine
// (recon Phase B, docs/BANK_RECONCILIATION_PLAN.md §4). Same pattern as
// accounting-engine.spec.js — import the ESM module in the browser, no I/O.

test('recon engine matches statement rows through deterministic tiers', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/recon-engine.js');
        const day = (d) => new Date(`2026-06-${String(d).padStart(2, '0')}T05:00:00Z`);
        const row = (id, { credit = 0, debit = 0, date, desc = '' } = {}) =>
            ({ id, credit, debit, transaction_date: day(date), description_raw: desc });
        const tx = (id, over = {}) =>
            ({ id, amount: 450000, type: 'expense', timestamp: day(10), vendor_name: 'AWS', ...over });

        const run = (rows, transactions, bankAccountId = null) =>
            e.matchStatementRows({ rows, transactions, bankAccountId });

        return {
            // R1: transaction already linked to the exact row id.
            r1: run([row('rowA', { debit: 450000, date: 10 })],
                [tx('t1', { bank_statement_row_id: 'rowA' })]).assignments,
            // R2: amount + direction + same day.
            r2: run([row('rowB', { debit: 450000, date: 10 })], [tx('t2')]).assignments,
            // R3: amount + direction, 3 days apart (boundary).
            r3: run([row('rowC', { debit: 450000, date: 13 })], [tx('t3')]).assignments,
            // Beyond R3 window without description overlap → no match.
            r3miss: run([row('rowD', { debit: 450000, date: 15, desc: 'PLN LISTRIK' })], [tx('t4')]).assignments,
            // R4: 5 days apart + description token overlap.
            r4: run([row('rowE', { debit: 450000, date: 15, desc: 'TRSF AWS CLOUD SERVICES' })],
                [tx('t5', { vendor_name: 'AWS Cloud' })]).assignments,
            // Direction mismatch: statement money-in vs expense → no match.
            dirMiss: run([row('rowF', { credit: 450000, date: 10 })], [tx('t6')]).assignments,
            // Amount mismatch → no match.
            amtMiss: run([row('rowG', { debit: 450001, date: 10 })], [tx('t7')]).assignments,
            // Already-reconciled and voided transactions are never candidates.
            reconMiss: run([row('rowH', { debit: 450000, date: 10 })],
                [tx('t8', { recon_status: 'reconciled' }), tx('t9', { is_voided: true })]).assignments,
            // Transaction linked to a DIFFERENT bank account is excluded.
            acctMiss: run([row('rowI', { debit: 450000, date: 10 })],
                [tx('t10', { cash_account_id: 'other-acct' })], 'stmt-acct').assignments,
            // Same account strengthens evidence, still matches.
            acctHit: run([row('rowJ', { debit: 450000, date: 10 })],
                [tx('t11', { cash_account_id: 'stmt-acct' })], 'stmt-acct').assignments,
            // One-to-one greedy: two rows, one transaction — only one wins,
            // and the closer date wins the tie.
            greedy: run([
                row('rowK', { debit: 450000, date: 12 }),
                row('rowL', { debit: 450000, date: 10 })
            ], [tx('t12')]).assignments,
            // Income direction works through type fallback.
            income: run([row('rowM', { credit: 9000000, date: 10 })],
                [tx('t13', { amount: 9000000, type: 'income', vendor_name: 'Client' })]).assignments,
            // Tie-out math.
            tieOk: e.computeTieOut({ openingBalance: 1000, closingBalance: 1500,
                rows: [{ credit: 700 }, { debit: 200 }] }),
            tieDelta: e.computeTieOut({ openingBalance: 1000, closingBalance: 2000,
                rows: [{ credit: 700 }, { debit: 200 }] }),
            tieNull: e.computeTieOut({ openingBalance: null, closingBalance: 2000, rows: [] })
        };
    });

    expect(r.r1.rowA?.rule).toBe('R1');
    expect(r.r2.rowB?.rule).toBe('R2');
    expect(r.r2.rowB?.confidence).toBe('exact');
    expect(r.r3.rowC?.rule).toBe('R3');
    expect(r.r3.rowC?.confidence).toBe('strong');
    expect(r.r3miss.rowD).toBeUndefined();
    expect(r.r4.rowE?.rule).toBe('R4');
    expect(r.r4.rowE?.confidence).toBe('review');
    expect(r.dirMiss.rowF).toBeUndefined();
    expect(r.amtMiss.rowG).toBeUndefined();
    expect(r.reconMiss.rowH).toBeUndefined();
    expect(r.acctMiss.rowI).toBeUndefined();
    expect(r.acctHit.rowJ?.evidence).toContain('same bank account');
    // Greedy one-to-one: the same-day row wins; the other stays unmatched.
    expect(r.greedy.rowL?.transaction_id).toBe('t12');
    expect(r.greedy.rowK).toBeUndefined();
    expect(r.income.rowM?.rule).toBe('R2');
    // Tie-out.
    expect(r.tieOk.delta).toBe(0);
    expect(r.tieDelta.delta).toBe(500);
    expect(r.tieNull).toBeNull();
});
