'use strict';

// =============================================================================
// The public order endpoint writes a document the till can still update, and
// never reads a price from the customer.
//
// TWO FAILURE MODES, BOTH SILENT, BOTH ALREADY SEEN IN PRODUCTION:
//
//   1. A KEY THE RULES DO NOT ALLOW. `wsPosOrderKeys` in firestore.rules is a
//      `hasOnly`, and the cashier's next update sends the WHOLE document back.
//      An extra key written here is not refused when it is written — the Admin
//      SDK bypasses rules — it is refused later, on every subsequent till write
//      to that order. On 2026-08-31 that exact shape (bare `cash`/`clearing`
//      field names failing a `hasOnly`) meant a day of till sales never reached
//      the ledger. A missing key is the same defect from the other side: the
//      till reads `undefined` and posts a total of NaN.
//
//   2. A PRICE FROM THE BROWSER. The request carries item ids and quantities;
//      every rupiah must come from `items.sales_price`. Nothing at runtime
//      would notice a request whose price was believed — the order would post,
//      balance, and be wrong.
//
// Both are static facts about the source, so this check needs no Firestore, no
// emulator and no network.
//
// Run: node tests/qr-order.check.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'netlify/functions/qr-order.js'), 'utf8');
const RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (actual, expected, label) => {
    if (actual === expected) ok(label);
    else fail(`${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

console.log('\nqr-order\n');

// --- 1. The document shape matches the rules exactly -----------------------

/** The key list from `wsPosOrderKeys(data) { return data.keys().hasOnly([...]) }`. */
function rulesKeys() {
    const at = RULES.indexOf('function wsPosOrderKeys(');
    if (at === -1) throw new Error('wsPosOrderKeys not found in firestore.rules');
    const open = RULES.indexOf('hasOnly([', at);
    const close = RULES.indexOf(']);', open);
    return RULES.slice(open + 'hasOnly(['.length, close)
        // Comments inside the list are load-bearing prose, not keys.
        .replace(/\/\/[^\n]*/g, '')
        .split(',')
        .map((s) => s.trim().replace(/^'|'$/g, ''))
        .filter(Boolean);
}

/** The keys of the object literal passed to `tx.set(orderRef, { ... })`. */
function writtenKeys() {
    const at = SRC.indexOf('tx.set(orderRef, {');
    if (at === -1) throw new Error('tx.set(orderRef, {...}) not found in qr-order.js');
    // Walk braces so nested objects and arrays cannot end the scan early.
    const start = SRC.indexOf('{', at);
    let depth = 0; let end = start;
    for (let i = start; i < SRC.length; i += 1) {
        if (SRC[i] === '{') depth += 1;
        else if (SRC[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    const body = SRC.slice(start + 1, end).replace(/\/\/[^\n]*/g, '');
    // Top-level keys only: a key at brace depth 0 of this literal.
    const keys = [];
    let d = 0;
    body.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (d === 0) {
            // `key: value` and the ES6 shorthand `key,` are both real keys —
            // matching only the first silently under-reports the shape, which
            // is the very thing this check exists to measure.
            const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?::|,\s*$)/);
            if (m) keys.push(m[1]);
        }
        for (const ch of line) {
            if (ch === '{' || ch === '[') d += 1;
            else if (ch === '}' || ch === ']') d -= 1;
        }
    });
    return keys;
}

const allowed = rulesKeys();
const written = writtenKeys();

is(allowed.length > 20, true, `firestore.rules allows ${allowed.length} pos_orders keys`);

const extra = written.filter((k) => !allowed.includes(k));
if (extra.length) {
    fail(`qr-order writes key(s) the rules REFUSE: ${extra.join(', ')}\n`
        + '      The Admin SDK write succeeds, then every later till update to that\n'
        + '      order fails permission-denied. Add the key to wsPosOrderKeys and\n'
        + '      deploy the rules (npm run rules:deploy), or stop writing it.');
} else {
    ok('every key written is allowed by wsPosOrderKeys');
}

const absent = allowed.filter((k) => !written.includes(k));
if (absent.length) {
    fail(`qr-order omits key(s) createPosOrder writes: ${absent.join(', ')}\n`
        + '      The till reads undefined for these. A missing total_amount or\n'
        + '      lines posts NaN; a missing status_changed_at breaks the kitchen\n'
        + '      screen’s waiting timer.');
} else {
    ok('every key the rules allow is written — the shape matches createPosOrder');
}

// --- 2. The customer's prices are never read -------------------------------
// The request body is `body`; its line objects are `req`. Reading a price off
// either is the defect.
const PRICE_FIELDS = ['price', 'unit_price', 'sales_price', 'amount', 'total',
    'total_amount', 'gross_amount', 'price_delta', 'modifier_amount', 'subtotal'];
const clientReads = [];
PRICE_FIELDS.forEach((f) => {
    // `req.<price>` or `body.<price>` — the two names the request is bound to.
    const re = new RegExp(`\\b(req|body)\\.${f}\\b`, 'g');
    const hits = SRC.match(re);
    if (hits) clientReads.push(...hits);
});
if (clientReads.length) {
    fail(`a price is read from the REQUEST: ${[...new Set(clientReads)].join(', ')}\n`
        + '      Every amount must come from items.sales_price or the item’s own\n'
        + '      modifier options. A submitted price must not be validated — it\n'
        + '      must not be read at all.');
} else {
    ok('no price is read from the request body');
}

// And the positive statement: the price IS read from the item.
is(/Number\(item\.sales_price\)/.test(SRC), true,
    'the unit price is read from items.sales_price');
is(/Number\(o\.price_delta\)/.test(SRC), true,
    'each modifier delta is read from the item’s own option');

// --- 3. Only menu-visible items are orderable ------------------------------
is(/i\.pos_visible !== true/.test(SRC), true,
    'an item that is not on the menu cannot be ordered by knowing its id');
is(/i\.status === 'archived'/.test(SRC), true, 'an archived item is refused');
is(/dir\.revoked === true/.test(SRC), true, 'a revoked table token is refused');

// --- 4. Idempotency ---------------------------------------------------------
// A phone on restaurant wifi retries. Without a ref, one timed-out tap becomes
// two kitchen tickets and a double bill.
is(/qr_order_refs\//.test(SRC), true, 'a client_ref is recorded so a retry is not a second order');
is(/duplicate: true/.test(SRC), true, '…and a repeat returns the original order rather than making one');
// The ref must NOT live on the order document — pos_orders has a hasOnly.
is(/client_ref:/.test(SRC.slice(SRC.indexOf('tx.set(orderRef, {'))), false,
    'the ref is not written onto pos_orders, which would break the hasOnly');

// --- 5. The line-merge key ---------------------------------------------------
// Same item, same price, same note, same options → one line. A kitchen ticket
// reading "1 x Nasi Goreng" four times is how a portion goes missing.
const lineKey = (() => {
    const at = SRC.indexOf('function lineKey(');
    const end = SRC.indexOf('\n}', at);
    // eslint-disable-next-line no-new-func
    return new Function(`${SRC.slice(at, end + 2)}; return lineKey;`)();
})();

const mods = (...ids) => ids.map((id) => ({ option_id: id, price_delta: 1000 }));
is(lineKey('a', 5000, null, []) === lineKey('a', 5000, null, []), true,
    'two identical lines share a key');
is(lineKey('a', 5000, null, []) === lineKey('a', 5000, '', []), true,
    'a null note and an empty note are the same line');
is(lineKey('a', 5000, 'pedas', []) === lineKey('a', 5000, null, []), false,
    'a note makes it a different line — the kitchen must not merge them');
is(lineKey('a', 5000, null, mods('x', 'y')) === lineKey('a', 5000, null, mods('y', 'x')), true,
    'option ORDER does not matter — the same two options are the same line');
is(lineKey('a', 5000, null, mods('x')) === lineKey('a', 5000, null, mods('x', 'y')), false,
    'a different option set is a different line');
is(lineKey('a', 5000, null, []) === lineKey('a', 6000, null, []), false,
    'a price change is a different line — a repriced item must not merge into the old one');

// --- 6. The append path patches, never overwrites ---------------------------
// A whole-document set from a stale read would revert a cashier's discount or
// unset their shift while they were working the same order.
const appendStart = SRC.indexOf('if (openDoc) {');
// Searched FROM the block's start. A bare indexOf finds the first `} else {`
// in the file, which sits earlier, and silently yields an empty slice that
// passes every negative assertion below for the wrong reason.
// Anchored on the OUTER `} else {` by its indentation. The merge loop inside
// contains its own, more deeply indented, and stopping there cuts the block in
// half — before `tx.update`, so the assertions below would report a defect that
// is not there.
const appendBlock = SRC.slice(appendStart, SRC.indexOf('\n        } else {', appendStart));
is(/tx\.update\(ref, patch\)/.test(appendBlock), true,
    'appending to an open order is a targeted update');
is(/tx\.set\(ref/.test(appendBlock), false,
    '…never a whole-document set, which a stale read would use to revert the till');
// ⚠️ THE APPENDABLE SET IS THE STATES WHERE ORDERING IS STILL OFFERED.
// It read `open || submitted`, so the moment the kitchen moved a ticket to
// `sent` a second round stopped matching, the client retried without a sitting,
// and a WHOLE NEW ORDER DOCUMENT appeared for the same table — one unpaid
// session split across two bills, and two live orders on one table.
is(/APPENDABLE = \['open', 'submitted', 'sent', 'ready', 'served'\]/.test(SRC), true,
    'a second round appends across every state where ordering is still offered');
// `awaiting_payment` stays out: the bill has been requested and a cashier may
// already have quoted it, so silently growing that total is worse than
// refusing. `paid` and `void` are terminal.
is(/APPENDABLE/.test(SRC) && /'awaiting_payment'/.test(
    (SRC.match(/const APPENDABLE = \[[^\]]*\]/) || [''])[0]), false,
    'a bill already requested cannot be silently grown');
is(/!APPENDABLE\.includes\(o\.status\)/.test(appendBlock), true,
    'an order paid, voided or sent to the cashier mid-tap is refused');
// New food means the kitchen has work again. Without this the added lines sit
// on a ticket the board reads as `served`: on the bill, nobody cooking it.
is(/patch\.status = 'submitted'/.test(appendBlock), true,
    'a post-kitchen order is sent back for acknowledgement when more is added');

// ── The two item projections ────────────────────────────────────────────
//
// ⚠️ `getPosMenu` (the till) and `qr-menu` (the diner) each project an explicit
// WHITELIST. A field added to `items` and left out of one arrives as `undefined`
// and the feature silently does nothing on that surface — how
// pos_modifier_groups, barcode and image_path each failed on their first cut
// (items.md §9). This pins the pair for `pos_recommended`.
const posSvc = fs.readFileSync(path.join(ROOT, 'assets/js/pos-service.js'), 'utf8');
const qrMenuSrc = fs.readFileSync(path.join(ROOT, 'netlify/functions/qr-menu.js'), 'utf8');
const dbSvc = fs.readFileSync(path.join(ROOT, 'assets/js/db-service.js'), 'utf8');

is(/pos_recommended:\s*data\.pos_recommended/.test(dbSvc), true,
    'saveItem persists pos_recommended — without it the drawer toggle does nothing');
is(/pos_recommended:\s*i\.pos_recommended/.test(posSvc), true,
    'getPosMenu projects pos_recommended (undefined at the till otherwise)');
is(/recommended:\s*i\.pos_recommended/.test(qrMenuSrc), true,
    'qr-menu projects it to the diner (the rail never renders otherwise)');

console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nqr-order: clean\n');
process.exit(failures ? 1 : 0);
