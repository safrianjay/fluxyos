'use strict';

// =============================================================================
// What a till bill adds up to.
//
// Pure, so it runs in milliseconds and can be unconditional in the BE lane.
// Everything it guards is a wrong NUMBER on a customer's receipt and in the
// books — never a crash — which is the failure mode this codebase loses time to.
//
// The claims:
//
//   1. No settings = exactly what shipped before. Every existing workspace has
//      no doc, and the bill must not move under them.
//   2. `revenue` + `service` + `tax` == `total`, always. The emitter derives net
//      as total − service − tax, so a module that disagrees with that identity
//      puts an unbalanced journal into the ledger.
//   3. Inclusive tax EXTRACTS, it does not add. Adding a tax the menu price
//      already contains charges the customer twice.
//   4. The service charge is computed on the DISCOUNTED base. Charging service
//      on the pre-discount figure means the discount is partly taken back.
//   5. Rates are bounded and junk is inert — a rate of 1100, -5, null or "abc"
//      must not produce a bill.
//
// Run: node tests/pos-pricing.check.js
// =============================================================================

const path = require('path');
const P = require(path.join(__dirname, '..', 'assets', 'js', 'pos-pricing.js'));

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const eq = (a, b, label) => { if (a === b) return true; fail(`${label}: got ${a}, expected ${b}`); return false; };

console.log('\npos bill pricing\n');

// --- 1. The untouched workspace ---------------------------------------------
{
    const r = P.computeBillTotals({ subtotal: 100000, discountTotal: 10000, settings: null });
    const clean = eq(r.total, 90000, 'no settings → total') && eq(r.tax, 0, 'no settings → tax')
        && eq(r.service, 0, 'no settings → service') && eq(r.revenue, 90000, 'no settings → revenue');
    if (clean) ok('an outlet with no settings bills exactly what it billed before');
}

// --- 2 & 4 & 5. The identity, across a grid ---------------------------------
{
    let identity = 0; let cases = 0; let baseOk = 0;
    for (const subtotal of [0, 1, 12345, 100000, 999999]) {
        for (const discount of [0, 500, 100000, 999999999]) {
            for (const taxRate of [0, 10, 11, 12.5, 100]) {
                for (const svcRate of [0, 5, 10]) {
                    for (const inclusive of [false, true]) {
                        for (const svcTaxable of [false, true]) {
                            cases += 1;
                            const r = P.computeBillTotals({
                                subtotal, discountTotal: discount,
                                settings: {
                                    tax_enabled: true, tax_rate_percent: taxRate, tax_inclusive: inclusive,
                                    service_enabled: true, service_rate_percent: svcRate,
                                    service_taxable: svcTaxable
                                }
                            });
                            const label = `sub ${subtotal} disc ${discount} tax ${taxRate}${inclusive ? 'i' : ''} svc ${svcRate}${svcTaxable ? 't' : ''}`;
                            // The identity the sale emitter depends on.
                            if (r.revenue + r.service + r.tax === r.total) identity += 1;
                            else fail(`revenue+service+tax != total (${label})`);
                            // Every figure is a whole minor unit.
                            for (const k of ['base', 'service', 'tax', 'total', 'revenue']) {
                                if (!Number.isInteger(r[k])) fail(`${k} is not an integer (${label})`);
                            }
                            if (r.total < 0 || r.revenue < 0) fail(`negative bill (${label})`);
                            // Service is charged on what the customer actually pays for.
                            const base = Math.max(0, subtotal - Math.min(subtotal, discount));
                            const wantSvc = svcRate > 0 ? Math.round(base * svcRate / 100) : 0;
                            if (r.service === wantSvc) baseOk += 1;
                            else fail(`service computed on the wrong base (${label})`);
                        }
                    }
                }
            }
        }
    }
    if (identity === cases) ok(`revenue + service + tax == total, always (${cases} combinations)`);
    if (baseOk === cases) ok('the service charge is always computed on the DISCOUNTED base');
}

// --- 3. Inclusive extracts --------------------------------------------------
{
    const excl = P.computeBillTotals({
        subtotal: 100000, discountTotal: 0,
        settings: { tax_enabled: true, tax_rate_percent: 11, tax_inclusive: false, service_enabled: false }
    });
    const incl = P.computeBillTotals({
        subtotal: 100000, discountTotal: 0,
        settings: { tax_enabled: true, tax_rate_percent: 11, tax_inclusive: true, service_enabled: false }
    });
    eq(excl.total, 111000, 'exclusive adds 11%');
    eq(excl.revenue, 100000, 'exclusive keeps the menu price as revenue');
    // The customer pays the menu price either way; what changes is whose money it is.
    eq(incl.total, 100000, 'inclusive does NOT add to the bill');
    eq(incl.tax, 9910, 'inclusive carves the tax out (100000 − 100000/1.11)');
    eq(incl.revenue, 90090, 'inclusive reduces revenue by the tax it contained');
    if (incl.total === 100000 && incl.tax === 9910) {
        ok('inclusive pricing extracts the tax rather than adding it again');
    }
}

// --- 5. Junk is inert -------------------------------------------------------
{
    let inert = true;
    for (const bad of [1100, -5, null, undefined, 'abc', NaN, Infinity, {}]) {
        const r = P.computeBillTotals({
            subtotal: 50000, discountTotal: 0,
            settings: { tax_enabled: true, tax_rate_percent: bad, service_enabled: false }
        });
        // A rate over 100 is clamped, and anything unusable is treated as none.
        if (r.total < 50000 || r.total > 100000 || !Number.isInteger(r.total)) {
            fail(`a tax rate of ${String(bad)} produced total ${r.total}`);
            inert = false;
        }
    }
    if (inert) ok('an out-of-range or junk rate can never produce a runaway bill');
}

// --- 6. Discount presets ----------------------------------------------------
{
    eq(P.presetDiscountAmount({ kind: 'percent', value: 20 }, 50000), 10000, 'percent preset');
    eq(P.presetDiscountAmount({ kind: 'amount', value: 5000 }, 50000), 5000, 'amount preset');
    // A preset can never hand money back or exceed the bill.
    eq(P.presetDiscountAmount({ kind: 'amount', value: 999999 }, 50000), 50000, 'amount preset is capped at the base');
    eq(P.presetDiscountAmount({ kind: 'percent', value: 999 }, 50000), 50000, 'percent preset is capped at 100%');
    eq(P.presetDiscountAmount({ kind: 'percent', value: -5 }, 50000), 0, 'a negative preset is inert');
    eq(P.presetDiscountAmount({ kind: 'amount', value: 5000 }, 0), 0, 'nothing to discount');
    ok('a discount preset can never exceed the bill or hand money back');
}

console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\npos pricing: clean\n');
process.exit(failures ? 1 : 0);
