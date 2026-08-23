#!/usr/bin/env node
'use strict';
//
// The price book exists in two places that cannot import each other: the client
// (assets/js/billing-config.js) and the security rules (firestore.rules), which
// are the only server-side enforcement a static site has.
//
// Drift between them is silent in the direction that matters. If the rules keep
// an old price, checkout renders the new one and every payment is rejected with
// a bare permission-denied — no message names the price. If the rules keep a
// HIGHER price, a customer can be charged more than the page quoted them.
//
// This also checks the arithmetic the rules rely on being exact: tax is computed
// as (subtotal - discount) * rate / 100 in integer math on both sides, which is
// only safe while every subtotal is a multiple of 100 minor units.

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const failures = [];

const cfgSrc = fs.readFileSync(path.join(ROOT, 'assets/js/billing-config.js'), 'utf8');
const rulesSrc = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

// ---- the client's book ------------------------------------------------------
const book = {};
const bookBlock = cfgSrc.slice(cfgSrc.indexOf('export const PLAN_PRICES'), cfgSrc.indexOf('export const BILLING_TAX'));
let currentCcy = null;
bookBlock.split('\n').forEach((line) => {
    const ccy = line.match(/^\s{4}([A-Z]{3}):\s*\{/);
    if (ccy) { currentCcy = ccy[1]; book[currentCcy] = {}; return; }
    const row = line.match(/^\s{8}(\w+):\s*\{\s*monthly:\s*(\d+),\s*annualMonthlyEquivalent:\s*(\d+)/);
    if (row && currentCcy) {
        book[currentCcy][row[1]] = { monthly: Number(row[2]), annually: Number(row[3]) * 12 };
    }
});

// ---- the rules' book -------------------------------------------------------
const rulesBook = {};
const rulesBlock = rulesSrc.slice(rulesSrc.indexOf('function billingSubtotal'), rulesSrc.indexOf('function billingTaxRate'));
for (const m of rulesBlock.matchAll(/'([A-Z]{3})\|(\w+)\|(\w+)':\s*(\d+)/g)) {
    rulesBook[`${m[1]}|${m[2]}|${m[3]}`] = Number(m[4]);
}

// ---- tax rates -------------------------------------------------------------
const cfgTax = {};
for (const m of cfgSrc.slice(cfgSrc.indexOf('export const BILLING_TAX')).matchAll(/([A-Z]{3}):\s*\{\s*rate:\s*(\d+)/g)) {
    cfgTax[m[1]] = Number(m[2]);
    if (Object.keys(cfgTax).length >= 8) break;
}
const rulesTax = {};
const taxBlock = rulesSrc.slice(rulesSrc.indexOf('function billingTaxRate'), rulesSrc.indexOf('function isValidBillingAmounts'));
for (const m of taxBlock.matchAll(/'([A-Z]{3})':\s*(\d+)/g)) rulesTax[m[1]] = Number(m[2]);

// ---- compare ---------------------------------------------------------------
const currencies = Object.keys(book);
if (!currencies.length) failures.push('could not parse PLAN_PRICES from billing-config.js');

let pairs = 0;
currencies.forEach((ccy) => {
    Object.keys(book[ccy]).forEach((plan) => {
        ['monthly', 'annually'].forEach((freq) => {
            const key = `${ccy}|${plan}|${freq}`;
            const want = book[ccy][plan][freq];
            pairs += 1;
            if (!(key in rulesBook)) {
                failures.push(`firestore.rules billingSubtotal has no entry for ${key} (client sells it at ${want})`);
            } else if (rulesBook[key] !== want) {
                failures.push(`${key}: client ${want} vs rules ${rulesBook[key]} — checkout would be rejected or overcharge`);
            }
            // Integer tax math is only exact while subtotals are whole hundreds.
            if (want % 100 !== 0) {
                failures.push(`${key} subtotal ${want} is not a multiple of 100 — (subtotal * rate / 100) truncates, and the client and rules would disagree`);
            }
        });
    });
});
Object.keys(rulesBook).forEach((key) => {
    const [ccy, plan, freq] = key.split('|');
    if (!book[ccy] || !book[ccy][plan] || book[ccy][plan][freq] == null) {
        failures.push(`firestore.rules accepts ${key} (${rulesBook[key]}) but the client has no such price`);
    }
});
currencies.forEach((ccy) => {
    if (cfgTax[ccy] == null) failures.push(`BILLING_TAX has no rate for ${ccy}`);
    else if (rulesTax[ccy] !== cfgTax[ccy]) {
        failures.push(`${ccy} tax: client ${cfgTax[ccy]}% vs rules ${rulesTax[ccy]}% — every checkout in ${ccy} would be rejected`);
    }
});

if (failures.length) {
    console.error('billing price book: DRIFT\n');
    failures.forEach((f) => console.error('  ✗ ' + f));
    console.error('\n  The client and firestore.rules must carry identical prices.');
    console.error('  Edit PLAN_PRICES and billingSubtotal() together, then re-deploy rules.');
    process.exit(1);
}
console.log(`billing price book: in sync (${pairs} price points across ${currencies.join(', ')}; tax ${currencies.map((c) => `${c} ${cfgTax[c]}%`).join(', ')})`);
