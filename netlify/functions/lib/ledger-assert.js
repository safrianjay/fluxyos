'use strict';

// =============================================================================
// FluxyOS — ledger integrity assertions (accounting kernel)
//
// The five reconciliations from docs/ACCOUNTING_SPEC_REVIEW.md §10, run as
// assertions rather than as a script somebody remembers to invoke.
//
// Why this exists: posting is client-side, and Firestore rules can verify a
// journal's TOTALS balance but cannot sum its lines[] array. The compensating
// control was scripts/reconcile-ledger-balances.js — dry-run, single-workspace,
// manual. That control only fires when someone suspects a problem, which is
// exactly when a silent divergence has already been silent for a while: journal
// coverage drifted from the transaction set for weeks before anyone measured it.
//
// Read-only by construction. Detection and repair are deliberately separate —
// repair stays with the script's --commit path, so a scheduled job can never
// rewrite the ledger on its own.
//
// Shared by netlify/functions/ledger-integrity-sweep.js (scheduled) and
// scripts/reconcile-ledger-balances.js (manual), so the two can never disagree
// about what "correct" means.
// =============================================================================

const toInt = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };

// Account codes the assertions pin. Mirrors CHART_OF_ACCOUNTS_SEED in
// assets/js/accounting-engine.js — kept as literals because this file runs under
// CommonJS in a Cloud/Netlify function and the engine is browser ESM.
const AR = '1100';
const AP = '2000';
const CASH = '1000';

// Natural balance: assets/expenses are debit-positive, everything else credit-
// positive. Mirrors signedBalance() in the engine.
function signed(type, debit, credit) {
    return (type === 'asset' || type === 'expense') ? debit - credit : credit - debit;
}

// Cumulative per-account totals from ledger_balances (the trial-balance source —
// never sum all journal lines for this; that is the §7 scalability rule).
async function readLedgerBalances(base) {
    const snap = await base.collection('ledger_balances').get();
    const byAccount = {};
    snap.forEach((d) => {
        const b = d.data() || {};
        const code = String(b.account_code || '');
        if (!code) return;
        const acc = byAccount[code] || (byAccount[code] = { debit: 0, credit: 0, type: b.account_type || null });
        acc.debit += toInt(b.debit_total);
        acc.credit += toInt(b.credit_total);
        if (!acc.type && b.account_type) acc.type = b.account_type;
    });
    return byAccount;
}

// Expected A/R: open IDR invoices + outstanding pending_receivable accruals.
// Same composition as getAgingReport in db-service.js, so a failure here means
// the aging report and the balance sheet have genuinely diverged — which is the
// whole reason A/R is closed to manual journals.
async function expectedReceivables(base) {
    const [invoices, accruals] = await Promise.all([
        base.collection('invoices').get(),
        base.collection('transactions').where('type', '==', 'pending_receivable').get()
    ]);
    let total = 0;
    let count = 0;
    invoices.forEach((d) => {
        const inv = d.data() || {};
        if (inv.status !== 'open') return;
        if (inv.currency && inv.currency !== 'IDR') return; // never entered the IDR kernel
        total += toInt(inv.total_amount);
        count += 1;
    });
    accruals.forEach((d) => {
        const tx = d.data() || {};
        if (tx.is_voided) return;
        if (tx.accounting_status === 'excluded') return;
        total += toInt(tx.amount);
        count += 1;
    });
    return { total, count };
}

// PPh withheld from a supplier bill. Mirrors billWithheldAmount() in
// assets/js/tax-engine.js — duplicated rather than imported because that is
// browser ESM and this runs as CommonJS in a function. Keep the two in step.
function billWithheld(bill) {
    const rate = Number(bill && bill.withholding_rate) || 0;
    if (rate <= 0) return 0;
    const total = toInt(bill.amount);
    if (total <= 0) return 0;
    const ppnRate = Number(bill.tax_rate_percent) || 0;
    const stored = toInt(bill.taxable_base);
    const base = stored > 0 ? stored : (ppnRate > 0 ? Math.round(total / (1 + ppnRate / 100)) : total);
    return Math.round((base * rate) / 100);
}

// Expected A/P: what the SUBLEDGERS say is still owed — unpaid IDR bills net of
// part-payments AND net of withheld PPh, plus pending_payable accruals, plus
// subscription accruals.
//
// Two corrections learned from a real false-negative pair on one workspace:
//   • Withheld PPh is credited to 2110 at accrual, so A/P never owed it. Counting
//     the gross made a correctly-posted withheld bill look like a discrepancy.
//   • SUB-ACCRUE credits A/P too. Ignoring subscriptions made every workspace with
//     one report a permanent gap of exactly the subscription balance.
async function expectedPayables(base) {
    const [bills, accruals, subs] = await Promise.all([
        base.collection('bills').get(),
        base.collection('transactions').where('type', '==', 'pending_payable').get(),
        base.collection('subscriptions').get()
    ]);
    let total = 0;
    let count = 0;
    bills.forEach((d) => {
        const bill = d.data() || {};
        if (bill.payment_status === 'paid' || bill.linked_transaction_id) return;
        if (bill.currency && bill.currency !== 'IDR') return;
        const gross = bill.outstanding_amount != null
            ? Math.max(0, toInt(Math.abs(bill.outstanding_amount)))
            : Math.max(0, toInt(Math.abs(bill.amount)) - toInt(Math.abs(bill.amount_paid)));
        const outstanding = Math.max(0, gross - billWithheld(bill));
        if (!outstanding) return;
        total += outstanding;
        count += 1;
    });
    accruals.forEach((d) => {
        const tx = d.data() || {};
        if (tx.is_voided) return;
        if (tx.accounting_status === 'excluded') return;
        total += toInt(tx.amount);
        count += 1;
    });
    subs.forEach((d) => {
        const s = d.data() || {};
        if (s.is_voided) return;
        if (s.accounting_status === 'excluded') return;
        if (s.currency && s.currency !== 'IDR') return;
        total += toInt(s.amount);
        count += 1;
    });
    return { total, count };
}

// Recompute every account/period balance from journal LINES — the authoritative
// source — and check the global trial balance at the same time. This is the check
// that catches balanced totals hiding lopsided lines, which rules cannot see.
//
// Keys match the ledger_balances doc id (`{period_key}__{account_code}`) so the
// result can be diffed against stored balances directly, and
// scripts/reconcile-ledger-balances.js can write from it on --commit. Shared
// deliberately: the detector and the repair tool must agree on "correct".
async function recomputeFromJournalLines(base, { onlyPeriod = null } = {}) {
    const snap = await base.collection('journals').get();
    const expected = {};
    let globalDebit = 0;
    let globalCredit = 0;
    let posted = 0;
    snap.forEach((d) => {
        const j = d.data() || {};
        if (j.status === 'draft') return; // drafts never touch the ledger
        if (onlyPeriod && j.period_key !== onlyPeriod) return;
        posted += 1;
        (j.lines || []).forEach((l) => {
            const code = String(l.account_code || '');
            if (!code) return;
            const key = `${j.period_key}__${code}`;
            const row = expected[key] || (expected[key] = {
                period_key: j.period_key, account_code: code,
                account_type: l.account_type, debit: 0, credit: 0
            });
            row.debit += toInt(l.debit);
            row.credit += toInt(l.credit);
            globalDebit += toInt(l.debit);
            globalCredit += toInt(l.credit);
        });
    });
    return { expected, globalDebit, globalCredit, posted };
}

// Sources that should have a journal but do not. This is the coverage gap that
// blocked the Phase 2 cutover — a source with NO accounting_status at all was
// invisible to the old pending-only count, so a period could be closed over an
// incomplete ledger.
//
// The rules here MIRROR DataService._collectUnpostedSources (the shipped Close
// gate) on purpose: transfer/adjustment/custom transaction types never post, so
// counting them would make this check permanently red and train people to ignore
// it. If that list changes, change it in both places.
const POSTABLE_TX_TYPES = new Set([
    'income', 'revenue', 'refund', 'expense', 'fee', 'tax',
    'pending_receivable', 'pending_payable'
]);
const TERMINAL_STATUS = new Set(['posted', 'excluded']);

async function unpostedSources(base) {
    let missing = 0;
    let checked = 0;
    const isUnposted = (d) => !TERMINAL_STATUS.has(String(d.accounting_status || '')) && !d.journal_ref;

    const [txs, bills, subs] = await Promise.all([
        base.collection('transactions').get(),
        base.collection('bills').get(),
        base.collection('subscriptions').get()
    ]);

    txs.forEach((d) => {
        const t = d.data() || {};
        if (t.is_voided) return;
        if (!POSTABLE_TX_TYPES.has(String(t.type || '').toLowerCase())) return;
        checked += 1;
        if (isUnposted(t)) missing += 1;
    });
    [bills, subs].forEach((snap) => snap.forEach((d) => {
        const doc = d.data() || {};
        if (doc.is_voided) return;
        checked += 1;
        if (isUnposted(doc)) missing += 1;
    }));

    return { missing, checked };
}

/**
 * Run every integrity assertion for one workspace. Read-only.
 * Returns { workspace_id, checked_at, ok, checks[] } where each check is
 * { id, ok, severity, expected, actual, delta, detail }.
 *
 * `severity: 'info'` never flips `ok` — used for signals that can legitimately
 * differ (bank GL vs statement balance differs by unpresented items by design).
 */
async function assertWorkspaceLedger(db, workspaceId) {
    const base = db.collection('workspaces').doc(workspaceId);
    const [balances, ar, ap, recomputed, unposted] = await Promise.all([
        readLedgerBalances(base),
        expectedReceivables(base),
        expectedPayables(base),
        recomputeFromJournalLines(base),
        unpostedSources(base)
    ]);

    const checks = [];
    const push = (id, ok, severity, expected, actual, detail) => {
        checks.push({ id, ok, severity, expected, actual, delta: actual - expected, detail });
    };

    // #1 — A/R control account ties to the invoice subledger.
    const arBal = balances[AR] || { debit: 0, credit: 0 };
    push('ar_subledger', signed('asset', arBal.debit, arBal.credit) === ar.total, 'error',
        ar.total, signed('asset', arBal.debit, arBal.credit),
        `GL ${AR} vs ${ar.count} open receivable(s)`);

    // #2 — A/P control account ties to the bill subledger.
    const apBal = balances[AP] || { debit: 0, credit: 0 };
    push('ap_subledger', signed('liability', apBal.debit, apBal.credit) === ap.total, 'error',
        ap.total, signed('liability', apBal.debit, apBal.credit),
        `GL ${AP} vs ${ap.count} unpaid payable(s)`);

    // #4 (global) — every posted journal line foots.
    push('trial_balance', recomputed.globalDebit === recomputed.globalCredit, 'error',
        recomputed.globalDebit, recomputed.globalCredit,
        `${recomputed.posted} posted journal(s)`);

    // ledger_balances snapshot vs the journals it was incremented from. Compared
    // per ACCOUNT (summed across periods), matching how `balances` is aggregated —
    // a per-period diff belongs to the repair script, which reports drift/missing/
    // orphan at doc granularity.
    const wantByAccount = {};
    Object.values(recomputed.expected).forEach((row) => {
        const acc = wantByAccount[row.account_code] || (wantByAccount[row.account_code] = { debit: 0, credit: 0 });
        acc.debit += row.debit;
        acc.credit += row.credit;
    });
    let driftedAccounts = 0;
    let driftAmount = 0;
    new Set([...Object.keys(wantByAccount), ...Object.keys(balances)]).forEach((code) => {
        const want = wantByAccount[code] || { debit: 0, credit: 0 };
        const got = balances[code] || { debit: 0, credit: 0 };
        if (want.debit !== got.debit || want.credit !== got.credit) {
            driftedAccounts += 1;
            driftAmount += Math.abs(want.debit - got.debit) + Math.abs(want.credit - got.credit);
        }
    });
    push('ledger_balances_drift', driftedAccounts === 0, 'error', 0, driftedAccounts,
        driftedAccounts
            ? `${driftedAccounts} account(s) drifted by Rp${driftAmount} — repair with scripts/reconcile-ledger-balances.js --commit`
            : 'ledger_balances match the journal lines');

    // Coverage — sources that never produced a journal.
    push('journal_coverage', unposted.missing === 0, 'error', 0, unposted.missing,
        `${unposted.missing} of ${unposted.checked} IDR source(s) have no journal`);

    // #5 — bank GL vs the last certified statement balance. INFORMATIONAL: these
    // legitimately differ by unpresented items, so it reports without failing.
    let bankDetail = 'no bank snapshot recorded';
    let bankActual = 0;
    let bankExpected = 0;
    try {
        const snap = await base.collection('bank_balance_snapshots')
            .orderBy('created_at', 'desc').limit(1).get();
        const cashBal = balances[CASH] || { debit: 0, credit: 0 };
        bankActual = signed('asset', cashBal.debit, cashBal.credit);
        if (!snap.empty) {
            const s = snap.docs[0].data() || {};
            bankExpected = toInt(s.balance != null ? s.balance : s.closing_balance);
            bankDetail = `GL ${CASH} vs latest bank snapshot`;
        }
    } catch (_) { bankDetail = 'bank snapshot unavailable'; }
    push('bank_balance', true, 'info', bankExpected, bankActual, bankDetail);

    const ok = checks.every((c) => c.severity === 'info' || c.ok);
    return { workspace_id: workspaceId, checked_at: new Date().toISOString(), ok, checks };
}

module.exports = { assertWorkspaceLedger, recomputeFromJournalLines, signed, toInt };
