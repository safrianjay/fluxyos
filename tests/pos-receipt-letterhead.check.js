// =============================================================================
// FluxyOS — the printed receipt's letterhead
//
// The receipt is written into a NEW WINDOW with `document.write` and printed
// immediately, which makes almost none of it reachable from a normal spec. What
// CAN be asserted is the shape of the template and the order of operations
// around it — and those are exactly the parts that break silently:
//
//   · a popup opened after an `await` has lost its user activation and is
//     BLOCKED, so the receipt simply never appears;
//   · a logo sized in px runs off a 58mm roll;
//   · a letterhead built from the SELECTED outlet prints one shop's address on
//     another shop's reprint.
// =============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'assets/js/pos.js'), 'utf8');

let failures = 0;
const is = (actual, expected, label) => {
    const ok = actual === expected;
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const ok = (cond, label) => is(!!cond, true, label);

console.log('\nreceipt letterhead\n');

// ── The order Jay asked for: logo on top, address under it ──────────────────
const logoAt = src.indexOf('<div class="logo">');
const nameAt = src.indexOf('<h1>${esc((outlet && outlet.name)');
const addrAt = src.indexOf('<div class="c m addr">');
ok(logoAt > 0, 'the receipt prints a logo when one is set');
ok(addrAt > 0, 'the receipt prints the outlet address');
ok(logoAt < nameAt, 'the logo is above the outlet name');
ok(nameAt < addrAt, 'the address is below the name');
// Both are conditional: an outlet with neither must not print an empty box or a
// stray blank line above the order.
ok(/\$\{head\.logo \? `<div class="logo">/.test(src), 'no logo means no logo block');
ok(/\$\{head\.address \? `<div class="c m addr">/.test(src), 'no address means no address block');

// ── The paper is 58mm and the printer is black and white ────────────────────
//
// ⚠️ A CAP IN mm, NOT px. A logo exported at 2000px wide is normal, and on a
// roll that is 58mm across it would simply run off the edge — there is no
// viewport here to be relative to.
ok(/\.logo img \{[^}]*max-width: \d+mm/.test(src), 'the logo is capped in millimetres');
ok(/\.logo img \{[^}]*max-height: \d+mm/.test(src), 'the logo height is capped too');
ok(/\.logo img \{[^}]*object-fit: contain/.test(src),
    'the logo keeps its own proportions rather than being cropped');
// An address is one field and an owner may well have typed three lines into it.
ok(/\.addr \{[^}]*white-space: pre-line/.test(src), 'a multi-line address keeps its line breaks');

// ── The popup must be opened inside the click ───────────────────────────────
//
// ⚠️ THIS IS THE ONE THAT FAILS SILENTLY. Fetching the letterhead made
// `openReceipt` async; a `window.open` that now sits below the first `await` has
// lost its user activation and browsers block it, so nothing prints and there is
// no error to see.
const body = src.slice(src.indexOf('async function openReceipt('));
const openAt = body.indexOf("window.open('', '_blank'");
const firstAwait = body.indexOf('await ');
ok(openAt > 0, 'the receipt still opens a window');
ok(firstAwait > 0, 'the receipt awaits its letterhead');
is(openAt < firstAwait, true,
    'the popup is opened BEFORE the first await, while the click still counts');

// ── The letterhead belongs to the ORDER's outlet ────────────────────────────
//
// A reprint is routinely pulled up hours later, and a cashier who has since
// switched outlets would otherwise print the wrong shop's address.
ok(/receiptHead\(o\.dimension_id\)/.test(src),
    'the letterhead is keyed on the order\'s own outlet, not the selected one');
ok(/receiptHeadCache/.test(src), 'the letterhead is cached rather than refetched per print');
// ⚠️ THE PROMISE IS CACHED, NOT THE RESULT: two receipts printed in the same
// breath would otherwise both miss and both fetch.
ok(/receiptHeadCache\.set\(dimensionId, p\)/.test(src),
    'the in-flight fetch is cached, so a double print does not double fetch');

// ── A failed letterhead must not stop a receipt ─────────────────────────────
//
// A receipt that prints without its logo is a receipt. One that does not print
// because the logo failed is a queue at the counter.
ok(/catch \(_\) \{[\s\S]{0,240}return \{ logo: null, address: null \};/.test(src),
    'a letterhead that cannot be loaded still prints the receipt');

// ── The logo reaches the print window as bytes, not a handle ────────────────
const dal = fs.readFileSync(path.join(ROOT, 'assets/js/pos-service.js'), 'utf8');
ok(/async getPosOutletLogoDataURL\(/.test(dal), 'the logo is read as a data: URI');
ok(/readAsDataURL/.test(dal), 'it is inlined into the markup');
// ⚠️ A blob: URL belongs to the document that made it and the print job races
// its lifetime; a data: URI is part of the page the printer reads.
ok(!/getPosOutletLogoObjectURL/.test(dal),
    'the receipt is not handed a blob: URL that can be revoked under the print job');

// ── The field has to be allowed by rules, or EVERY write to the doc fails ───
//
// ⚠️ `wsPosOutletKeys` IS A `hasOnly`. Shipping `logo_image_path` without it in
// that list does not break logos — it breaks saving opening hours, tax rates and
// the address too, with `permission-denied` and nothing to say why.
const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const keyList = /function wsPosOutletKeys\(data\) \{[\s\S]*?\]\);/.exec(rules);
ok(keyList && keyList[0].includes("'logo_image_path'"),
    'logo_image_path is in the outlet-settings hasOnly');
ok(/data\.logo_image_path is string && data\.logo_image_path\.size\(\) <= 300/.test(rules),
    'logo_image_path is bounded like every other stored path');
// ⚠️ AND OPTIONAL. Reading a key that is not on the map THROWS in rules rather
// than evaluating to null, so without the `in` guard a payload that omits this
// field fails the WHOLE validator — and on deploy day that is every tab still
// running yesterday's JS, denied on saving its opening hours.
ok(/!\('logo_image_path' in data\)/.test(rules),
    'a payload without logo_image_path is still allowed to save');

console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nreceipt letterhead: clean\n');
process.exit(failures ? 1 : 0);
