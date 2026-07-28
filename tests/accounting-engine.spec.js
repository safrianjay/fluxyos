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
            manual: e.buildManualJournal({ period_key: '2026-06', description: 'Depreciation', subtype: 'depreciation',
                lines: [{ account_code: '6400', debit: 250000 }, { account_code: '2000', credit: 250000 }] }),
            pkJakarta: e.periodKey(new Date('2026-06-30T17:30:00Z')),
            signedAsset: e.signedBalance('asset', 5000, 2000),
            signedLiability: e.signedBalance('liability', 2000, 9000),
            manualUnbalanced: (() => { try { e.buildManualJournal({ period_key: '2026-06', lines: [{ account_code: '6400', debit: 100 }] }); return 'no-throw'; } catch (_) { return 'threw'; } })()
        };
    });

    const balanced = (jr) => jr && jr.is_balanced && jr.total_debit === jr.total_credit && jr.total_debit > 0;

    // Every posting event is balanced.
    for (const key of ['expense', 'income', 'fee', 'pendPayable', 'billAccrue', 'billPay', 'invIssue', 'mapped', 'opening', 'closeProfit', 'manual']) {
        expect(balanced(r[key]), `${key} must be balanced`).toBe(true);
    }
    // System journals are tagged for the register/detail surfaces.
    expect(r.expense.journal_type).toBe('system');
    expect(r.expense.generated_by).toBe('posting_engine');
    expect(r.expense.description).toBe('Expense paid');
    // Manual journals are tagged manual and carry their subtype; an unbalanced
    // manual entry throws (it can never post).
    expect(r.manual.journal_type).toBe('manual');
    expect(r.manual.manual_subtype).toBe('depreciation');
    expect(r.manual.posting_rule_id).toBe('MANUAL');
    expect(r.manualUnbalanced).toBe('threw');
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

// An explicit account_code chosen in the entry drawer overrides automatic account
// resolution — for expenses AND income, and for ANY real account type (the picker,
// not the engine, gates what's offered per direction). Codes absent from the live
// chart fall back to the resolution chain (regression safety for legacy rows).
test('accounting engine honors an explicit account_code, falling back safely', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/accounting-engine.js');
        const d = new Date('2026-06-15T03:00:00Z');
        const j = (collection, id, document, mappings) => e.buildJournal({ collection, id, document, mappings, date: d });
        const debitCode = (jr) => (jr.lines.find((l) => l.debit > 0) || {}).account_code;
        const creditCode = (jr) => (jr.lines.find((l) => l.credit > 0) || {}).account_code;
        return {
            // Expense pinned to a specific opex account instead of the category default (6100).
            expExplicit: debitCode(j('transactions', 'a1', { type: 'expense', amount: 150000, category: 'Marketing', account_code: '6420' })),
            // Income pinned to Interest Income (7100, revenue-type) instead of Revenue (4000).
            incExplicit: creditCode(j('transactions', 'a2', { type: 'income', amount: 5000000, account_code: '7100' })),
            // Pending receivable honors the explicit revenue account too.
            arExplicit: creditCode(j('transactions', 'a3', { type: 'pending_receivable', amount: 300000, account_code: '7100' })),
            // Fee/tax opex path honors an explicit expense account.
            feeExplicit: debitCode(j('transactions', 'a4', { type: 'fee', amount: 2500, account_code: '6440' })),
            // Unknown code → falls back to the resolution chain (Marketing → 6100).
            expBadCode: debitCode(j('transactions', 'a5', { type: 'expense', amount: 150000, category: 'Marketing', account_code: '9999' })),
            // An explicit pick is honored regardless of type — the drawer picker gates
            // what's offered per direction, so the engine trusts a real chosen code.
            incAnyType: creditCode(j('transactions', 'a6', { type: 'income', amount: 5000000, account_code: '2100' })),
            // No account_code → unchanged legacy behavior (income credits 4000).
            incNoCode: creditCode(j('transactions', 'a7', { type: 'income', amount: 5000000 })),
            explicitHelper: e.explicitAccount({ account_code: '6420' }, 'expense')
        };
    });
    expect(r.expExplicit).toBe('6420');
    expect(r.incExplicit).toBe('7100');
    expect(r.arExplicit).toBe('7100');
    expect(r.feeExplicit).toBe('6440');
    expect(r.expBadCode).toBe('6100');
    expect(r.incAnyType).toBe('2100');
    expect(r.incNoCode).toBe('4000');
    expect(r.explicitHelper).toBe('6420');
});

// A USER-CREATED account (absent from the static seed) is honored when the live
// chart is passed to buildJournal via `accounts` — this is the exact bug a founder
// hit creating a custom "Service Fee" account and picking it in Add Transaction.
// Without the overlay the code isn't recognized and the entry falls back to a seed
// default; with it, the posted line carries the account's real code, type, and name.
test('accounting engine honors a user-created account from the live chart overlay', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/accounting-engine.js');
        const d = new Date('2026-06-15T03:00:00Z');
        // A custom account the user made — a code the seed doesn't contain.
        const accounts = { '6810': { type: 'expense', name: 'Service Fee' } };
        const debit = (jr) => jr.lines.find((l) => l.debit > 0) || {};
        // Money Out expense pinned to the custom account, WITH the live chart.
        const withOverlay = debit(e.buildJournal({
            collection: 'transactions', id: 'u1',
            document: { type: 'expense', amount: 90000, category: 'Marketing', account_code: '6810' },
            accounts, date: d
        }));
        // WITHOUT the overlay the unknown code isn't a real account → chain fallback (6100).
        const noOverlay = debit(e.buildJournal({
            collection: 'transactions', id: 'u2',
            document: { type: 'expense', amount: 90000, category: 'Marketing', account_code: '6810' },
            date: d
        }));
        // The overlay is scoped to the single call — it doesn't leak into later journals.
        const afterCode = debit(e.buildJournal({
            collection: 'transactions', id: 'u3',
            document: { type: 'expense', amount: 90000, category: 'Marketing', account_code: '6810' },
            date: d
        }));
        return {
            overlayCode: withOverlay.account_code, overlayName: withOverlay.account_name,
            overlayType: withOverlay.account_type,
            noOverlayCode: noOverlay.account_code, afterCode: afterCode.account_code
        };
    });
    expect(r.overlayCode).toBe('6810');
    expect(r.overlayName).toBe('Service Fee');
    expect(r.overlayType).toBe('expense');
    expect(r.noOverlayCode).toBe('6100'); // falls back without the live chart
    expect(r.afterCode).toBe('6100');      // no state leak between builds
});
