// =============================================================================
// FluxyOS — a workspace outside Indonesia gets its own language and tax word
//
// ⚠️ WHAT THIS EXISTS FOR. A Singapore restaurant set up its POS and got the
// whole till and inventory in Indonesian, with "PPN" — a tax it does not charge
// — on its settings screen, its receipts and its diners' bills. Neither is a
// translation gap: the dashboard is Bahasa-FIRST by design and 'PPN' was
// hardcoded as the default in four places, so both were working exactly as
// written and exactly wrong for three of the four markets the product sells to.
//
// Static assertions, because both failures are silent: the app renders
// perfectly, in the wrong language, naming the wrong tax.
// =============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const is = (actual, expected, label) => {
    const ok = actual === expected;
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

console.log('\nmarket localisation\n');

// ── 1. Every market the product sells to has a tax word ─────────────────────
const money = require(path.join(ROOT, 'assets/js/money-format.js'));
const EXPECTED = { ID: ['PPN', 11], PH: ['VAT', 12], SG: ['GST', 9], MY: ['SST', 8] };
Object.keys(EXPECTED).forEach((c) => {
    is(money.defaultTaxLabel(c), EXPECTED[c][0], `${c} calls the tax on a bill ${EXPECTED[c][0]}`);
    is(money.defaultTaxRate(c), EXPECTED[c][1], `${c} defaults to ${EXPECTED[c][1]}%`);
});
// An unknown or missing country is Indonesia — every workspace that predates
// the field is one, and guessing "foreign" would rename the home market's tax.
is(money.defaultTaxLabel(null), 'PPN', 'an unknown country keeps the home market default');

// ── 2. Nothing hardcodes the Indonesian word as its default ─────────────────
[
    ['assets/js/pos-service.js', 'the till writes'],
    ['settings-pos.html', 'the settings screen seeds']
].forEach(([rel, what]) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // The literal may still appear in a comment or as a last-resort fallback
    // beside the lookup; what must not happen is a bare `|| 'PPN'` with no
    // country consulted anywhere in the file.
    is(/defaultTaxLabel|taxWord/.test(src), true, `${what} the tax word from the country`);
});

// ── 3. The dashboard language follows the workspace ─────────────────────────
const i18n = fs.readFileSync(path.join(ROOT, 'assets/js/dashboard-i18n.js'), 'utf8');
is(/function workspaceCountry\(\)/.test(i18n), true,
    'the language default can see the workspace country');
is(/country && country !== 'ID'\) \? 'en' : 'id'/.test(i18n), true,
    'a non-Indonesian workspace defaults to English');
// ⚠️ AN EXPLICIT CHOICE MUST STILL WIN, in both directions — an Indonesian
// owner running a Singapore branch may well want Bahasa.
is(/var stored = storedLang\(\);\s*\n\s*if \(stored\) return stored;/.test(i18n), true,
    'a stored choice still wins over the country');
// ⚠️ AND TRANSLATION MUST WAIT FOR THE COUNTRY. translatePage() is one-way —
// it does not keep the English originals — so translating before the workspace
// resolves paints a Singapore till Indonesian with nothing able to undo it.
is(/whenReady\(\)\.then\(decide, decide\)/.test(i18n), true,
    'translation waits for the workspace before deciding');
is(/setTimeout\(decide, \d+\)/.test(i18n), true,
    'a resolution that never lands still falls back rather than hanging in English');

// ── 4. The receipt is authored in English and translated ────────────────────
//
// It is written into a NEW WINDOW, which the MutationObserver never reaches, so
// `tr()` has to run in the parent document before the markup is handed over.
// ⚠️ CODE, NOT PROSE. The first version of this matched the COMMENT that
// explains the fix — the same weak assertion that let a missing directory write
// pass because the file still mentioned the collection.
const stripComments = (src) => src.split('\n')
    .filter((l) => {
        const t = l.trim();
        return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
const pos = stripComments(fs.readFileSync(path.join(ROOT, 'assets/js/pos.js'), 'utf8'));
["'Diskon'", "'Layanan'", "'Pajak'", 'Termasuk '].forEach((literal) => {
    is(pos.includes(literal), false, `the receipt no longer hardcodes ${literal}`);
});
const dict = fs.readFileSync(path.join(ROOT, 'assets/js/dashboard-i18n.js'), 'utf8');
[['Subtotal', 'Subtotal'], ['Discount', 'Diskon'], ['Service', 'Layanan'],
    ['Tax', 'Pajak'], ['Total', 'Total'], ['Includes', 'Termasuk']].forEach(([en, id]) => {
    const m = new RegExp(`"${en}": "([^"]+)"`).exec(dict);
    is(m && m[1], id, `the receipt's "${en}" still round-trips to Bahasa`);
});

// ── 5. The diner's menu knows which country it is for ───────────────────────
const qrMenu = fs.readFileSync(path.join(ROOT, 'netlify/functions/qr-menu.js'), 'utf8');
is(/country: \['ID', 'PH', 'SG', 'MY'\]/.test(qrMenu), true,
    'qr-menu tells the page which country the outlet is in');
const order = fs.readFileSync(path.join(ROOT, 'order.html'), 'utf8');
is(/function englishOnly\(\)/.test(order), true,
    'the order app knows when the switcher does not belong');
// ⚠️ `[hidden]` IS A UA RULE and the button's own `display: inline-flex` beats
// it, so the switcher would stay on screen with `hidden` set and nothing to
// show for it.
is(/\.lang-btn\[hidden\] \{ display: none; \}/.test(order), true,
    'hiding the switcher actually hides it');
// A Singapore mobile is EIGHT digits; Indonesia's floor of nine locked those
// diners out of the identity gate entirely.
is(/PHONE_MIN_DIGITS = \{ ID: 9, SG: 8, MY: 9, PH: 10 \}/.test(order), true,
    'the phone floor is a country fact, not Indonesia\'s');

console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nmarket localisation: clean\n');
process.exit(failures ? 1 : 0);
