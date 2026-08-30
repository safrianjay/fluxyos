'use strict';

// =============================================================================
// The POS service's edge into the rest of DataService.
//
// `assets/js/pos-service.js` is mixed onto DataService.prototype, so `this` is a
// full DataService and the POS code CAN call anything on it. Nothing stops a
// future edit from reaching one method deeper — and each one it reaches is
// another thing that must be untangled before a lean till bundle is possible.
// That is the whole reason the extraction happened, so the edge is pinned here.
//
// This is not a style rule. Every entry below is a real obstacle:
//
//   _postSourceJournal      reaches the accounting kernel
//   _resolveSaleConsumption reaches inventory costing, shared with commerce
//   getItems/getStockMovements  inventory reads
//   addTransaction          the whole transaction write path
//
// Adding to ALLOWED is allowed — deliberately, with a reason in the commit. What
// this stops is the coupling growing by accident and nobody noticing until the
// standalone extraction turns out to be impossible.
//
// Run: node tests/pos-service-boundary.check.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const POS = path.join(ROOT, 'assets/js/pos-service.js');

// The nine methods the POS DAL reached into at extraction time (2026-08-30).
const ALLOWED = new Set([
    '_scope',                  // the workspace-scoping seam. Never route around it.
    '_resolvedScopeId',        // workspace id for a member session
    '_nullableString',         // string helper
    '_auditCreateBestEffort',  // audit logging
    '_postSourceJournal',      // ← accounting kernel
    '_resolveSaleConsumption', // ← inventory costing, shared with commerce
    'getItems',                // ← inventory read
    'getStockMovements',       // ← inventory read
    'addTransaction'           // ← transaction write path
]);

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

if (!fs.existsSync(POS)) {
    console.error('\n✗ assets/js/pos-service.js is missing — was the POS DAL folded back in?\n');
    process.exit(1);
}
const src = fs.readFileSync(POS, 'utf8');

console.log('\npos-service boundary\n');

// --- 1. what it calls on `this` -------------------------------------------
const called = new Set();
for (const m of src.matchAll(/this\.(_?[A-Za-z][A-Za-z0-9_]*)\s*\(/g)) called.add(m[1]);
// Methods defined INSIDE this module are not external calls. Matched on the
// name + open paren only: a default like `_posDayKey(d = new Date())` contains
// its own ')', so any attempt to match the full parameter list mis-reads it as
// undefined and reports a phantom boundary breach.
const defined = new Set();
for (const m of src.matchAll(/^\s{4}(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)) defined.add(m[1]);

const external = [...called].filter((c) => !defined.has(c)).sort();
const leaked = external.filter((c) => !ALLOWED.has(c));
if (leaked.length) {
    fail(`the POS service reaches ${leaked.length} NEW method(s) on DataService: ${leaked.join(', ')}\n`
        + '      Each one is another thing to untangle before a standalone till bundle.\n'
        + '      If the call is genuinely needed, add it to ALLOWED here and say why in the commit.');
} else {
    ok(`edge holds — ${external.length} external method(s), all declared`);
}

// A shrinking cone is progress and must not fail the build, but it should be
// visible: a stale ALLOWED entry hides the fact that the work got easier.
const unused = [...ALLOWED].filter((a) => !external.includes(a));
if (unused.length) {
    console.log(`  · ALLOWED lists ${unused.length} method(s) the POS service no longer calls `
        + `(${unused.join(', ')}) — the cone shrank; prune the list.`);
}

// --- 2. it must not import db-service ------------------------------------
// A circular import would work (db-service imports this one), but it would also
// mean the module can never be loaded on its own, which is the entire point.
if (/from\s+["'][^"']*db-service\.js["']/.test(src)) {
    fail('pos-service.js imports db-service.js — that circularity is exactly what stops it standing alone');
} else {
    ok('does not import db-service.js');
}

// --- 3. the mixin is actually applied ------------------------------------
const dbSrc = fs.readFileSync(path.join(ROOT, 'assets/js/db-service.js'), 'utf8');
if (!/Object\.assign\(DataService\.prototype,\s*POS_METHODS\)/.test(dbSrc)) {
    fail('db-service.js no longer applies POS_METHODS — every POS call site would be undefined at runtime');
} else {
    ok('POS_METHODS is mixed onto DataService.prototype');
}

// --- 4. the static list survived the move --------------------------------
// `DataService.POS_PAYMENT_METHODS` is read by pos.js and the specs. A mixin
// cannot supply a static, so the class keeps a getter delegating to the module.
if (!/static get POS_PAYMENT_METHODS\(\)/.test(dbSrc)) {
    fail('DataService.POS_PAYMENT_METHODS is gone — pos.js reads it for the payment picker');
} else {
    ok('DataService.POS_PAYMENT_METHODS still resolves');
}

// --- 5. nothing POS-shaped left behind -----------------------------------
// Compared against the names actually moved, not a name pattern. A pattern is
// wrong here: `/[Pp]os/` matches postManualJournal, postPendingJournals and
// every other post* method in the accounting kernel, which never left.
const dbDefined = new Set(
    [...dbSrc.matchAll(/^\s{4}(?:static\s+)?(?:async\s+)?(?:get\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)].map((m) => m[1])
);
const strays = [...defined].filter((n) => dbDefined.has(n));
if (strays.length) {
    fail(`POS-shaped method(s) still in db-service.js: ${strays.join(', ')} — split brain`);
} else {
    ok('no POS methods left in db-service.js');
}

if (failures) {
    console.error(`\n${failures} boundary problem(s).\n`);
    process.exit(1);
}
console.log('\npos-service boundary: clean\n');
