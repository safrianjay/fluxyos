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

// accounting_status values meaning "this document has no general-ledger effect".
// 'excluded' is deliberate non-participation (foreign currency); 'reversed' is
// stamped by DataService.reverseJournal when a source journal is undone.
//
// The subledger MUST honour both or it counts a payable/receivable the GL does
// not carry. Accrual transactions and subscriptions already skipped 'excluded';
// bills and invoices did not, which is why a single reversed bill put one
// workspace's A/P out by exactly its amount with nothing to explain it.
const OUT_OF_LEDGER = new Set(['excluded', 'reversed']);

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
// Per-dimension breakdown rows. Summed per {period_key, account_code} so they can
// be compared against the workspace-level ledger_balances rows they decompose.
async function readLedgerBalancesByDim(base) {
    const out = {};
    const snap = await base.collection('ledger_balances_by_dim').get();
    snap.forEach((d) => {
        const r = d.data() || {};
        const key = `${r.period_key}__${r.account_code}`;
        const e = out[key] || (out[key] = { debit: 0, credit: 0, rows: 0 });
        e.debit += Number(r.debit_total) || 0;
        e.credit += Number(r.credit_total) || 0;
        e.rows += 1;
    });
    return out;
}

async function expectedReceivables(base) {
    const [invoices, accruals] = await Promise.all([
        base.collection('invoices').get(),
        base.collection('transactions').where('type', '==', 'pending_receivable').get()
    ]);
    let total = 0;
    let count = 0;
    invoices.forEach((d) => {
        const inv = d.data() || {};
        // 'partial' belongs here as much as 'open'. Cash application (2026-07-29)
        // added open→partial→paid, and each payment posts INV-PAY (Dr Cash / Cr
        // A/R) drawing the receivable DOWN rather than settling it — so a partial
        // invoice still carries A/R in the GL. Matching 'open' alone dropped it
        // from the subledger entirely and reported a gap of exactly the
        // outstanding balance. Latent until the first partial payment lands in a
        // workspace, then wrong every night after.
        if (inv.status !== 'open' && inv.status !== 'partial') return;
        if (inv.currency && inv.currency !== 'IDR') return; // never entered the IDR kernel
        if (OUT_OF_LEDGER.has(inv.accounting_status)) return;
        // Outstanding, not face value — they are the same on an untouched open
        // invoice and differ on a partially paid one.
        const outstanding = inv.outstanding_amount != null
            ? Math.max(0, toInt(Math.abs(inv.outstanding_amount)))
            : Math.max(0, toInt(Math.abs(inv.total_amount)) - toInt(Math.abs(inv.amount_paid)));
        if (!outstanding) return;
        total += outstanding;
        count += 1;
    });
    accruals.forEach((d) => {
        const tx = d.data() || {};
        if (tx.is_voided) return;
        if (OUT_OF_LEDGER.has(tx.accounting_status)) return;
        total += toInt(tx.amount);
        count += 1;
    });
    return { total, count };
}

// PPh actually withheld on a bill — the amount stamped at accrual, never derived
// from withholding_rate. Mirrors billWithheldAmount() in assets/js/tax-engine.js
// (duplicated because that is browser ESM and this is CommonJS).
//
// Deriving it from the rate is wrong: the tax appendix is skipped entirely when a
// workspace has no tax profile, so a bill can carry a rate while its journal
// withheld nothing. One workspace reported a Rp1.038.013 phantom A/P gap that way
// — the assertion inventing a discrepancy on a perfectly correct ledger, which is
// the worst failure mode a checker has.
function billWithheld(bill) {
    return Math.max(0, toInt(bill && bill.withholding_amount));
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
        if (bill.payment_status === 'paid') return;
        // linked_transaction_id means "the transaction that fully settled this
        // bill" — _payBillOnce writes it under `if (fullyPaid)` only. Treating it
        // as settled-regardless was safe while paid was terminal, and became
        // wrong once a bill could go BACK to partial: a rolled-back bill keeps
        // the stamp from when it was paid, so the subledger valued a restored
        // Rp20.500.000 payable at zero and A/P would not tie no matter what the
        // bill's own fields said. An explicit partial/unpaid status wins.
        if (bill.linked_transaction_id && !['partial', 'unpaid'].includes(bill.payment_status)) return;
        if (bill.currency && bill.currency !== 'IDR') return;
        if (OUT_OF_LEDGER.has(bill.accounting_status)) return;
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
        if (OUT_OF_LEDGER.has(tx.accounting_status)) return;
        total += toInt(tx.amount);
        count += 1;
    });
    subs.forEach((d) => {
        const s = d.data() || {};
        if (s.is_voided) return;
        if (OUT_OF_LEDGER.has(s.accounting_status)) return;
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
// 'reversed' is terminal for COVERAGE, which asks "did this source ever reach
// the ledger?" — a reversed source did: its journal exists and was then undone
// deliberately. That is a different question from "does it still carry a
// balance?", which is OUT_OF_LEDGER's job above. Conflating the two would report
// every reversal as a coverage gap and send someone to the backfill runbook for
// a ledger that is already correct.
const TERMINAL_STATUS = new Set(['posted', 'excluded', 'reversed']);

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
    const [balances, ar, ap, recomputed, unposted, byDim] = await Promise.all([
        readLedgerBalances(base),
        expectedReceivables(base),
        expectedPayables(base),
        recomputeFromJournalLines(base),
        unpostedSources(base),
        readLedgerBalancesByDim(base)
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

    // #6 — the per-dimension breakdown must decompose the workspace row exactly.
    //
    // Both collections are written by FieldValue.increment in the SAME batch
    // (db-service _flushBalanceAcc), so they can only diverge through a bug or a
    // partial write — and the divergence is invisible from either side alone: the
    // workspace row still ties to the journals, and the by-dim rows still look
    // self-consistent. Lines with no dimension roll into '__unassigned__', so this
    // holds during rollout, not only once everything is dimensioned.
    //
    // Compared per {period, account} because that is the granularity the rollup
    // writes at. Skipped entirely when nothing has been written yet, so an
    // untouched workspace does not report a phantom failure.
    let dimMismatches = 0;
    let dimDelta = 0;
    if (Object.keys(byDim).length) {
        // recomputed.expected is already keyed `${period_key}__${account_code}`,
        // which is exactly the granularity the rollup writes at — no re-aggregation.
        new Set([...Object.keys(recomputed.expected), ...Object.keys(byDim)]).forEach((key) => {
            const want = recomputed.expected[key] || { debit: 0, credit: 0 };
            const got = byDim[key] || { debit: 0, credit: 0 };
            if (want.debit !== got.debit || want.credit !== got.credit) {
                dimMismatches += 1;
                dimDelta += Math.abs(want.debit - got.debit) + Math.abs(want.credit - got.credit);
            }
        });
    }
    push('ledger_balances_by_dim', dimMismatches === 0, 'error', 0, dimMismatches,
        !Object.keys(byDim).length
            ? 'no per-dimension rows yet — nothing to reconcile'
            : (dimMismatches
                ? `${dimMismatches} period/account pair(s) where the dimension breakdown does not sum to the ledger, by Rp${dimDelta}`
                : 'per-dimension rows sum to the ledger'));

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
