'use strict';

// =============================================================================
// Tax and service charge on a till bill post correctly.
//
// WHY THIS IS A PURE CHECK. Every failure this guards against is a PLAUSIBLE
// WRONG NUMBER, not a crash: a journal that balances while booking the
// government's PPN as this workspace's revenue looks exactly like a journal
// that does not. Nothing goes red, the trial balance still ties, and the owner
// is handed a margin they never earned.
//
// The four claims:
//
//   1. Every POS journal BALANCES, at every combination of discount, tax,
//      service and split tender.
//   2. `amount` is NET REVENUE. Tax and service never reach 4000, because every
//      revenue surface in the product sums transaction amounts.
//   3. The CASH side is what crossed the counter — net + service + tax. Debiting
//      the net alone leaves every drawer short by the tax the till took, and the
//      shift close posts the gap to 6700 as a loss.
//   4. A refund reverses tax and service too. Returning the whole bill to the
//      customer while only reversing revenue leaves the workspace owing PPN on a
//      sale that no longer exists — remitted out of the owner's own pocket.
//
// Run: node tests/pos-tax-service.check.js
// =============================================================================

const path = require('path');

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

const CASH = '1000';
const CLEARING = '1030';
const OUTPUT_TAX = '2100';
const REVENUE = '4000';
const SERVICE = '4100';
const DISCOUNTS = '4900';

const sum = (lines, code, side) => lines
    .filter((l) => l.account_code === code)
    .reduce((s, l) => s + (Number(l[side]) || 0), 0);

(async () => {
    const eng = await import(
        'file://' + path.join(__dirname, '..', 'assets', 'js', 'accounting-engine.js'));
    const { buildJournal, CHART_OF_ACCOUNTS_SEED } = eng;

    // Drive the PUBLIC path, not the rule table. `buildJournal` runs selectRule
    // and finalize as well, so a sale that stops resolving to POS-SALE — or a
    // journal finalize rejects — fails here rather than passing a unit test of a
    // function nothing calls that way.
    const journal = (collection, document) => {
        const j = buildJournal({ collection, id: 'chk', document });
        if (!j) throw new Error('no journal built — selectRule did not match');
        return j.lines;
    };
    const sale = (d) => journal('transactions', {
        type: 'income', source: 'pos', pos_order_id: 'o1', ...d
    });
    const refund = (d) => journal('transactions', {
        type: 'refund', source: 'pos', pos_order_id: 'o1', ...d
    });

    console.log('\npos tax & service charge\n');

    // --- 0. The accounts the rules address by literal code must exist --------
    const codes = new Set(CHART_OF_ACCOUNTS_SEED.map((a) => a.code));
    for (const [code, label] of [[OUTPUT_TAX, 'output VAT'], [SERVICE, 'service charge']]) {
        if (codes.has(code)) ok(`${code} (${label}) is in the seed`);
        else fail(`${code} (${label}) is addressed by a posting rule but is not seeded`);
    }
    const svc = CHART_OF_ACCOUNTS_SEED.find((a) => a.code === SERVICE);
    if (svc && svc.type === 'revenue') ok('4100 is revenue — the business earned it');
    else fail('4100 must be revenue');
    const vat = CHART_OF_ACCOUNTS_SEED.find((a) => a.code === OUTPUT_TAX);
    // The whole point. Tax collected is the government's money from the moment
    // the customer pays it; as revenue it would inflate income by the whole PPN.
    if (vat && vat.type === 'liability') ok('2100 is a LIABILITY, not revenue');
    else fail('2100 must be a liability — tax collected is not income');

    // --- 1..3. The sale ------------------------------------------------------
    const cases = [];
    for (const netRevenue of [100000, 37500]) {
        for (const discount of [0, 15000]) {
            for (const tax of [0, 11000]) {
                for (const service of [0, 5000]) {
                    for (const clearing of [0, 'half', 'all']) {
                        cases.push({ netRevenue, discount, tax, service, clearing });
                    }
                }
            }
        }
    }

    let balanced = 0; let revenueClean = 0; let cashClean = 0;
    for (const c of cases) {
        const collected = c.netRevenue + c.tax + c.service;
        const clearingAmt = c.clearing === 'all' ? collected
            : c.clearing === 'half' ? Math.round(collected / 2) : 0;
        const doc = {
            amount: c.netRevenue,
            pos_discount_amount: c.discount,
            pos_tax_amount: c.tax,
            pos_service_amount: c.service,
            pos_cash_amount: collected - clearingAmt,
            pos_clearing_amount: clearingAmt
        };
        const lines = sale(doc);
        const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
        const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
        const label = `net ${c.netRevenue} disc ${c.discount} tax ${c.tax} svc ${c.service} clr ${c.clearing}`;

        if (dr === cr) balanced += 1;
        else fail(`POS-SALE does not balance (${label}): Dr ${dr} vs Cr ${cr}`);

        // Revenue is the MENU's gross — never the tax, never the service.
        const revCr = sum(lines, REVENUE, 'credit');
        if (revCr === c.netRevenue + c.discount) revenueClean += 1;
        else fail(`revenue credit is ${revCr}, expected ${c.netRevenue + c.discount} (${label})`);

        // The drawer must reconcile to what crossed the counter.
        const cashDr = sum(lines, CASH, 'debit') + sum(lines, CLEARING, 'debit');
        if (cashDr === collected) cashClean += 1;
        else fail(`settlement debit is ${cashDr}, expected ${collected} (${label})`);

        if (sum(lines, OUTPUT_TAX, 'credit') !== c.tax) fail(`2100 credit wrong (${label})`);
        if (sum(lines, SERVICE, 'credit') !== c.service) fail(`4100 credit wrong (${label})`);
        if (sum(lines, DISCOUNTS, 'debit') !== c.discount) fail(`4900 debit wrong (${label})`);
    }
    if (balanced === cases.length) ok(`every POS-SALE journal balances (${cases.length} combinations)`);
    if (revenueClean === cases.length) ok('revenue is always net + discount — tax and service never reach 4000');
    if (cashClean === cases.length) ok('the settlement debit is always what crossed the counter');

    // --- 4. The refund ------------------------------------------------------
    let refundOk = 0;
    for (const c of cases) {
        const collected = c.netRevenue + c.tax + c.service;
        const clearingAmt = c.clearing === 'all' ? collected
            : c.clearing === 'half' ? Math.round(collected / 2) : 0;
        const doc = {
            amount: c.netRevenue,
            pos_tax_amount: c.tax,
            pos_service_amount: c.service,
            pos_cash_amount: collected - clearingAmt,
            pos_clearing_amount: clearingAmt
        };
        const lines = refund(doc);
        const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
        const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
        const back = sum(lines, CASH, 'credit') + sum(lines, CLEARING, 'credit');
        const label = `net ${c.netRevenue} tax ${c.tax} svc ${c.service} clr ${c.clearing}`;

        if (dr !== cr) { fail(`POS-REFUND does not balance (${label}): Dr ${dr} vs Cr ${cr}`); continue; }
        if (back !== collected) { fail(`refund returns ${back}, customer paid ${collected} (${label})`); continue; }
        // The liability has to come back off the books with the sale.
        if (sum(lines, OUTPUT_TAX, 'debit') !== c.tax) { fail(`2100 not reversed (${label})`); continue; }
        if (sum(lines, SERVICE, 'debit') !== c.service) { fail(`4100 not reversed (${label})`); continue; }
        refundOk += 1;
    }
    if (refundOk === cases.length) ok(`every POS-REFUND reverses revenue, tax and service (${cases.length} combinations)`);

    // --- 5. The zero case is byte-identical to what shipped before -----------
    //
    // Every workspace has tax and service at 0 until an owner sets a rate, and
    // an existing order re-posted by postPendingJournals must reproduce the
    // journal already on its books rather than a different one.
    const legacy = sale({ amount: 90000, pos_discount_amount: 10000 });
    const withZeros = sale({
        amount: 90000, pos_discount_amount: 10000, pos_tax_amount: 0, pos_service_amount: 0
    });
    if (JSON.stringify(legacy) === JSON.stringify(withZeros)) {
        ok('a zero-tax sale posts exactly what it posted before this change');
    } else {
        fail('zero tax/service changed the journal — every historical re-post would differ');
    }

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\npos tax & service: clean\n');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
