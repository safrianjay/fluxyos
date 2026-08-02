/**
 * FluxyOS — unit check for netlify/functions/lib/ledger-assert.js
 *
 * The nightly sweep is the compensating control for client-side posting, and it
 * runs somewhere nobody watches. So its logic is pinned here against an in-memory
 * Firestore double: no emulator, no credentials, no network.
 *
 * Run: node tests/ledger-assert.check.js   (npm run check:ledger-assert)
 * Exits non-zero on the first failure.
 */

const { assertWorkspaceLedger } = require('../netlify/functions/lib/ledger-assert');

// --- minimal Firestore double ---------------------------------------------
// Implements only what ledger-assert touches: collection().get(), .where(),
// .orderBy().limit().get(). Snapshots expose docs[]/forEach/empty like the real
// SDK, so the module under test is unmodified.
function makeDb(data) {
    const snap = (rows) => ({
        docs: rows.map(([id, d]) => ({ id, data: () => d })),
        forEach(fn) { this.docs.forEach(fn); },
        get empty() { return this.docs.length === 0; }
    });
    const col = (name) => {
        const rows = Object.entries(data[name] || {});
        const api = {
            get: async () => snap(rows),
            where: (field, op, value) => ({
                get: async () => snap(rows.filter(([, d]) => (op === '==' ? d[field] === value : true)))
            }),
            orderBy: () => api,
            limit: () => api,
            doc: () => ({ set: async () => {}, collection: col })
        };
        return api;
    };
    return { collection: () => ({ doc: () => ({ collection: col }) }) };
}

const journal = (period, lines, status = 'posted') => ({ period_key: period, status, lines });
const bal = (period, code, type, debit, credit) => ({
    period_key: period, account_code: code, account_type: type, debit_total: debit, credit_total: credit
});

let failures = 0;
function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) { failures += 1; console.error(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`); }
    else console.log(`  ok   ${label}`);
}
const byId = (report) => Object.fromEntries(report.checks.map((c) => [c.id, c]));

(async () => {
    // --- Clean books -------------------------------------------------------
    // One open invoice (A/R 1,110,000) and one unpaid bill (A/P 500,000), each
    // with its journal and matching ledger_balances. A `transfer` transaction is
    // present on purpose: transfers never post, so counting them as a coverage
    // gap would make the check permanently red.
    console.log('clean books:');
    const clean = await assertWorkspaceLedger(makeDb({
        journals: {
            j1: journal('2026-07', [
                { account_code: '1100', account_type: 'asset', debit: 1110000, credit: 0 },
                { account_code: '4000', account_type: 'revenue', debit: 0, credit: 1110000 }]),
            j2: journal('2026-07', [
                { account_code: '6400', account_type: 'expense', debit: 500000, credit: 0 },
                { account_code: '2000', account_type: 'liability', debit: 0, credit: 500000 }]),
            j3: journal('2026-07', [{ account_code: '6400', account_type: 'expense', debit: 1, credit: 0 }], 'draft')
        },
        ledger_balances: {
            '2026-07__1100': bal('2026-07', '1100', 'asset', 1110000, 0),
            '2026-07__4000': bal('2026-07', '4000', 'revenue', 0, 1110000),
            '2026-07__6400': bal('2026-07', '6400', 'expense', 500000, 0),
            '2026-07__2000': bal('2026-07', '2000', 'liability', 0, 500000)
        },
        invoices: {
            i1: { status: 'open', total_amount: 1110000, currency: 'IDR' },
            i2: { status: 'paid', total_amount: 999, currency: 'IDR' },
            i3: { status: 'open', total_amount: 50000, currency: 'USD' } // outside the IDR kernel
        },
        bills: {
            b1: { payment_status: 'unpaid', amount: 500000, accounting_status: 'posted' },
            b2: { payment_status: 'paid', amount: 123, accounting_status: 'posted' }
        },
        subscriptions: {},
        transactions: { t0: { type: 'transfer', amount: 999 } },
        bank_balance_snapshots: {}
    }), 'ws-clean');

    check('overall ok', clean.ok, true);
    check('A/R ties to the invoice subledger', byId(clean).ar_subledger.delta, 0);
    check('A/P ties to the bill subledger', byId(clean).ap_subledger.delta, 0);
    check('trial balance foots', byId(clean).trial_balance.ok, true);
    check('no ledger_balances drift', byId(clean).ledger_balances_drift.actual, 0);
    check('a draft journal is not counted as posted', byId(clean).trial_balance.detail, '2 posted journal(s)');
    check('transfers are not a coverage gap', byId(clean).journal_coverage.actual, 0);
    check('bank check never fails the sweep', byId(clean).bank_balance.severity, 'info');

    // --- Broken books ------------------------------------------------------
    // Three independent faults at once: an invoice whose journal is missing
    // 110,000 of A/R, a ledger_balances row 110 above its journal lines (the
    // shape of the real QA drift), and an expense transaction that never posted.
    console.log('\nbroken books:');
    const broken = await assertWorkspaceLedger(makeDb({
        journals: {
            j1: journal('2026-07', [
                { account_code: '1100', account_type: 'asset', debit: 1000000, credit: 0 },
                { account_code: '4000', account_type: 'revenue', debit: 0, credit: 1000000 }])
        },
        ledger_balances: {
            '2026-07__1100': bal('2026-07', '1100', 'asset', 1000110, 0),
            '2026-07__4000': bal('2026-07', '4000', 'revenue', 0, 1000000)
        },
        invoices: { i1: { status: 'open', total_amount: 1110000, currency: 'IDR' } },
        bills: {},
        subscriptions: {},
        transactions: { t1: { type: 'expense', amount: 25000 } },
        bank_balance_snapshots: {}
    }), 'ws-broken');

    check('overall not ok', broken.ok, false);
    check('A/R divergence is reported', byId(broken).ar_subledger.ok, false);
    check('ledger_balances drift is caught', byId(broken).ledger_balances_drift.actual, 1);
    check('an unposted source is caught', byId(broken).journal_coverage.actual, 1);
    check('trial balance still foots (drift is in the snapshot, not the lines)',
        byId(broken).trial_balance.ok, true);

    // --- Lopsided lines ----------------------------------------------------
    // The failure Firestore rules structurally cannot see: journal TOTALS balance
    // while the lines[] array does not. This is the reason the sweep exists.
    console.log('\nlopsided lines (rules cannot catch this):');
    const lopsided = await assertWorkspaceLedger(makeDb({
        journals: {
            j1: journal('2026-07', [
                { account_code: '6400', account_type: 'expense', debit: 100000, credit: 0 },
                { account_code: '1000', account_type: 'asset', debit: 0, credit: 70000 }])
        },
        ledger_balances: {},
        invoices: {}, bills: {}, subscriptions: {}, transactions: {}, bank_balance_snapshots: {}
    }), 'ws-lopsided');
    check('unbalanced lines fail the trial balance', byId(lopsided).trial_balance.ok, false);

    console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll ledger-assert checks passed.');
    process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
