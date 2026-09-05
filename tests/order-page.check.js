'use strict';

// =============================================================================
// `order.html` is internally consistent.
//
// WHY THIS EXISTS. Twice in one day a string-slice edit to this file deleted a
// whole CSS section: two markers were indexed without checking their order, so
// `s[:start] + s[end:]` removed everything between them instead of nothing. The
// second time it took out "Modifier groups" — `.field`, `.note-input`, `.opt`,
// `.optgroup`, `.detail-hero` — and SHIPPED. Every input in every sheet
// rendered unstyled and a customer found it before any check did.
//
// Nothing else could have caught it. The page parses, the specs assert
// behaviour and geometry rather than the existence of rules, and the design
// linter only reads changed lines. A page whose styles are half-deleted still
// answers every question those ask.
//
// So this check asserts the file agrees with itself: every class the markup or
// the JS puts on an element has a rule somewhere, and the sections that hold
// them are all still present.
//
// Run: node tests/order-page.check.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'order.html'), 'utf8');
const CSS = SRC.slice(SRC.indexOf('<style>'), SRC.indexOf('</style>'));

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (actual, expected, label) => {
    if (actual === expected) ok(label);
    else fail(`${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(expected === true ? actual : actual)}`);
};

console.log('\norder page\n');

// --- 1. Every class used has a rule ----------------------------------------
//
// State and utility classes are toggled by script and carry no rule of their
// own, or are styled only in combination (`.chip[aria-pressed]`, `.track-step.done`).
const STATE = new Set([
    'hidden', 'num', 'is-open', 'is-busy', 'is-on', 'failed', 'done', 'now',
    'invalid', 'on', 'inner', 'sm', 'lg', 'grand', 'line', 'empty', 'totals',
    'is-placeholder'
]);

// Take the LITERAL RUN after `class="`, with no closing quote required. That
// covers static markup (`class="a b"`) and the script's generated markup
// (`class="track-step' + cls + '"`, which yields `track-step`) with one rule —
// and it stops at the first character a class name cannot contain, so JS
// identifiers spliced in by concatenation are never mistaken for classes.
const used = new Set();
for (const m of SRC.matchAll(/class="([A-Za-z0-9 _-]*)/g)) {
    m[1].split(/\s+/).forEach((c) => c && used.add(c));
}

const defined = new Set([...CSS.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const orphans = [...used].filter((c) => !defined.has(c) && !STATE.has(c)).sort();

if (orphans.length) {
    fail(`class(es) used with no CSS rule: ${orphans.join(', ')}\n`
        + '      Either the rule was deleted or the class is a typo. A page with\n'
        + '      half its styles still parses, still passes the behavioural specs,\n'
        + '      and looks broken to a customer.');
} else {
    ok(`every one of the ${used.size} classes used has a rule`);
}

// --- 2. The sections themselves are all present ----------------------------
// Named because a deletion takes a contiguous run, and the run is a section.
const SECTIONS = [
    'Tokens', 'App frame', 'The FluxyOS loading animation', 'HERO',
    'Category tabs', 'Menu — a two-column grid', 'Order detail page',
    'Cart bar', 'Floating tab bar', 'Bottom sheets', 'Modifier groups',
    'Cart lines', 'Order status', 'Confirmation'
];
const missingSections = SECTIONS.filter((s) => !CSS.includes(s));
if (missingSections.length) {
    fail(`CSS section(s) missing: ${missingSections.join(', ')}`);
} else {
    ok(`all ${SECTIONS.length} CSS sections present`);
}

// --- 3. Elements the script addresses by id still exist --------------------
// `$('x')` on a missing id returns null and the next property access throws,
// taking the rest of the handler with it.
const ids = new Set([...SRC.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
const addressed = new Set([...SRC.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
const ghosts = [...addressed].filter((i) => !ids.has(i)).sort();
if (ghosts.length) fail(`script addresses id(s) that do not exist: ${ghosts.join(', ')}`);
else ok(`all ${addressed.size} ids the script addresses exist in the markup`);

// --- 4. No duplicate ids ---------------------------------------------------
// A slice that duplicates a block instead of removing it produces these, and
// getElementById silently returns the first.
const idList = [...SRC.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]);
const dupes = [...new Set(idList.filter((v, i) => idList.indexOf(v) !== i))];
if (dupes.length) fail(`duplicate id(s): ${dupes.join(', ')}`);
else ok('no duplicate ids');

// --- 5. The invariants the page is built on --------------------------------
is(/cdn\.tailwindcss\.com/.test(SRC), false,
    'no Tailwind — this page is mobile-Safari-first and injects its own sheets');
is(/firebasejs|firebase-app/.test(SRC), false,
    'no Firebase SDK — the customer has no account and never signs in');
is(/src="assets\/|href="assets\//.test(SRC), false,
    'no RELATIVE asset paths — under /t/<token> they resolve to 200-with-HTML');
is(/window\.FluxyMoney/.test(SRC), true, 'amounts go through the money seam');

console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\norder page: clean\n');
process.exit(failures ? 1 : 0);
