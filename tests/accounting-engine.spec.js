const { test, expect } = require('@playwright/test');

// Pure-logic unit test for the accounting kernel posting engine. Mirrors the
// billing-config.spec.js pattern: navigate to any served app page, then import
// the ESM module in the browser and assert against its pure outputs. No
// Firestore, no auth — the engine has no I/O.

test('accounting engine posts a balanced journal for every business event', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/accounting-engine.js');
        // Capture a throw as a plain, structured-cloneable object.
        const cap = (fn) => { try { return { ok: true, value: fn() ? 'built' : null }; }
            catch (err) { return { ok: false, code: err && err.code || null, message: String(err && err.message || err) }; } };
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
            // An Error cannot cross the page.evaluate boundary — stringify the
            // parts we assert on INSIDE the browser and return a plain object.
            manualUnbalanced: cap(() => e.buildManualJournal({ period_key: '2026-06',
                lines: [{ account_code: '6400', debit: 100 }, { account_code: '4000', credit: 60 }] })),
            manualSingleLine: cap(() => e.buildManualJournal({ period_key: '2026-06',
                lines: [{ account_code: '6400', debit: 100 }] })),
            // Policy gate: the human path refuses subledger/cash/equity accounts...
            policyBlocksAR: cap(() => e.assertManualJournalPolicy([{ account_code: '1100', debit: 100 }])),
            policyBlocksCash: cap(() => e.assertManualJournalPolicy([{ account_code: '1000', credit: 100 }])),
            policyAllowsOpex: cap(() => e.assertManualJournalPolicy([{ account_code: '6400', debit: 100 }])),
            // ...except for opening balances, the one legitimate human path in.
            policyAllowsOpening: cap(() => e.assertManualJournalPolicy(
                [{ account_code: '1000', debit: 100 }, { account_code: '3900', credit: 100 }], { subtype: 'opening' })),
            policyBlocksArchived: cap(() => e.assertManualJournalPolicy([{ account_code: '6510', debit: 100 }],
                { accounts: { '6510': { name: 'Custom', type: 'expense', is_active: false } } })),
            // The Tax Center posts through buildManualJournal DIRECTLY with the
            // very accounts the policy blocks. If the gate ever moves inside the
            // builder, monthly tax posting breaks silently — this is that alarm.
            taxInstalmentPosts: cap(() => e.buildManualJournal({ period_key: '2026-06', subtype: 'tax_instalment',
                lines: [{ account_code: '1140', debit: 500000 }, { account_code: '1000', credit: 500000 }] })),
            taxAnnualPosts: cap(() => e.buildManualJournal({ period_key: '2026-12', subtype: 'corporate_annual',
                lines: [{ account_code: '6500', debit: 900000 }, { account_code: '1140', credit: 400000 },
                        { account_code: '2200', credit: 500000 }] })),
            // GL_011: a structural account hand-picked onto a document is refused
            // rather than silently redirected to the default account.
            explicitBlocked: cap(() => e.explicitAccount({ account_code: '1100' })),
            explicitAllowed: cap(() => e.explicitAccount({ account_code: '6420' }, 'expense')),
            glCodes: e.GL
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
    // Structured error codes: callers discriminate on err.code, never on prose.
    expect(r.manualUnbalanced.ok).toBe(false);
    expect(r.manualUnbalanced.code).toBe(r.glCodes.UNBALANCED);
    // A one-line journal is GL_002, not "unbalanced (Dr 100 / Cr 0)" — the real
    // problem is the missing line, and the old wording sent people hunting for a
    // rounding difference that did not exist.
    expect(r.manualSingleLine.ok).toBe(false);
    expect(r.manualSingleLine.code).toBe(r.glCodes.TOO_FEW_LINES);

    // Manual-journal policy gate.
    expect(r.policyBlocksAR.code).toBe(r.glCodes.MANUAL_BLOCKED);
    expect(r.policyBlocksCash.code).toBe(r.glCodes.MANUAL_BLOCKED);
    expect(r.policyBlocksArchived.code).toBe(r.glCodes.ARCHIVED);
    expect(r.policyAllowsOpex.ok).toBe(true);
    expect(r.policyAllowsOpening.ok, 'opening balances stay possible in-app').toBe(true);

    // Tax Center regression — buildManualJournal itself must NOT enforce policy.
    expect(r.taxInstalmentPosts.ok, 'PPh 25 instalment must still post').toBe(true);
    expect(r.taxAnnualPosts.ok, 'annual corporate tax must still post').toBe(true);

    // GL_011 on hand-picked accounts.
    expect(r.explicitBlocked.ok).toBe(false);
    expect(r.explicitBlocked.code).toBe(r.glCodes.DIRECT_BLOCKED);
    expect(r.explicitAllowed.ok).toBe(true);
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
            // An explicit pick is honored regardless of TYPE — an asset or liability
            // account is a legitimate choice on either direction (buying an asset,
            // paying down a loan).
            incAnyType: creditCode(j('transactions', 'a6', { type: 'income', amount: 5000000, account_code: '2500' })),
            // ...but NOT regardless of POLICY. 2100 PPN Keluaran is fed exclusively
            // by the tax engine; crediting income straight to it would break the
            // PPN reconciliation. The engine refuses rather than quietly resolving
            // to the default account — a silent redirect posts somewhere the user
            // did not choose, which is worse than an error.
            incBlocked: (() => {
                try { j('transactions', 'a8', { type: 'income', amount: 5000000, account_code: '2100' }); return { ok: true }; }
                catch (err) { return { ok: false, code: err && err.code || null }; }
            })(),
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
    expect(r.incAnyType).toBe('2500');
    expect(r.incBlocked.ok).toBe(false);
    expect(r.incBlocked.code).toBe('GL_011');
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

// Cash application (Phase 2): the INV-PAY rule posts doc.amount, so a partial
// payment settles only part of the receivable. Two partials against one INV-ISSUE
// must draw Accounts Receivable (1100) back to exactly zero — the arithmetic the
// partial-payment DAL relies on.
test('accounting engine: partial invoice payments settle the receivable to zero', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/accounting-engine.js');
        const d = new Date('2026-06-15T03:00:00Z');
        // Issue a 1,000,000 invoice: Dr A/R (1100) / Cr Revenue (4000).
        const issue = e.buildJournal({ collection: 'invoices', id: 'inv1', document: { status: 'open', total_amount: 1000000, customer_name: 'Acme' }, date: d });
        // Two partial payments linked to it: Dr Cash (1000) / Cr A/R (1100).
        const pay1 = e.buildJournal({ collection: 'transactions', id: 'p1', document: { type: 'income', amount: 400000, linked_invoice_id: 'inv1' }, date: d });
        const pay2 = e.buildJournal({ collection: 'transactions', id: 'p2', document: { type: 'income', amount: 600000, linked_invoice_id: 'inv1' }, date: d });
        const arNet = [issue, pay1, pay2].reduce((sum, j) =>
            sum + j.lines.filter((l) => l.account_code === '1100').reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0), 0);
        const line = (j, code, side) => (j.lines.find((l) => l.account_code === code && l[side] > 0) || {})[side];
        return {
            issueAr: line(issue, '1100', 'debit'),
            pay1Rule: pay1.posting_rule_id,
            pay1Cash: line(pay1, '1000', 'debit'),
            pay1ArCredit: line(pay1, '1100', 'credit'),
            pay2ArCredit: line(pay2, '1100', 'credit'),
            arNet
        };
    });
    expect(r.issueAr).toBe(1000000);
    expect(r.pay1Rule).toBe('INV-PAY');
    expect(r.pay1Cash).toBe(400000);
    expect(r.pay1ArCredit).toBe(400000);
    expect(r.pay2ArCredit).toBe(600000);
    expect(r.arNet).toBe(0); // receivable fully drawn down
});
