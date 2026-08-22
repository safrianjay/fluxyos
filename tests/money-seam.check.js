'use strict';

// =============================================================================
// FluxyOS — money seam check (no network, no emulator, no browser)
//
// Guards the single currency-rendering seam that makes non-IDR workspaces
// possible (docs/PROJECT_BACKGROUND.md §4 — base currency).
//
// Why this exists: before the seam, ~85 sites across ~40 files built currency by
// hand as `'Rp' + n.toLocaleString('id-ID')`. Every one of them was three
// separate bugs waiting for a PHP workspace:
//
//   1. the SYMBOL is wrong          (Rp on a peso amount)
//   2. the DECIMALS are wrong       (IDR has 0, PHP/SGD/MYR have 2 — so a
//                                    centavo amount renders as 100x the money)
//   3. the SEPARATORS are wrong     (id-ID uses . for thousands; en-PH uses ,)
//
// None of those throw. They render a plausible, wrong number. That is exactly
// the failure class the structural checks in this repo exist to catch.
//
// Two checks:
//   A. REGISTRY   — every supported currency formats correctly, and IDR output
//                   is byte-identical to the inline formatters it replaced.
//   B. NO LITERALS— no hardcoded currency string survives on any workspace
//                   finance surface.
// =============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const Money = require(path.join(ROOT, 'assets/js/money-format.js'));

const failures = [];
const notes = [];
const fail = (check, msg) => failures.push({ check, msg });
const ok = (check, msg) => notes.push(`  ✓ ${check}: ${msg}`);

// --- A. registry ------------------------------------------------------------
//
// The expected strings below are the contract. If a locale's grouping changes
// under a new ICU, this check fails loudly rather than shipping a silent
// re-format of every figure in the app.
const EXPECT = [
    // [currency, minor units, rendered]
    ['IDR', 1234567,   'Rp1.234.567'],
    ['IDR', 0,         'Rp0'],
    ['IDR', 250000000, 'Rp250.000.000'],
    ['PHP', 120000000, '₱1,200,000.00'],
    ['PHP', 1,         '₱0.01'],
    ['SGD', 18000000,  'S$180,000.00'],
    ['MYR', 45000000,  'RM450,000.00'],
];

for (const [ccy, minor, want] of EXPECT) {
    Money.setBaseCurrency(ccy);
    const got = Money.formatBase(minor);
    if (got !== want) fail('registry', `${ccy} ${minor} -> "${got}", expected "${want}"`);
}
if (!failures.length) ok('registry', `${EXPECT.length} currency renders exact`);

// Byte-identity with the pre-seam inline formatter, across the value range the
// app actually renders. This is what makes the migration provably non-visual
// for every existing IDR workspace.
Money.setBaseCurrency('IDR');
const SAMPLES = [0, 1, 7, 999, 1000, 1234, 99999, 1e6, 1234567, 99999999, 1e9, 123456789012];
let drift = 0;
for (const v of SAMPLES) {
    const legacy = 'Rp' + Math.abs(Math.round(v)).toLocaleString('id-ID');
    if (Money.formatBase(Math.abs(Math.round(v))) !== legacy) drift++;
}
if (drift) fail('byte-identity', `${drift}/${SAMPLES.length} IDR values differ from the pre-seam output`);
else ok('byte-identity', `IDR identical to legacy formatter across ${SAMPLES.length} magnitudes`);

// Negative money is signed BEFORE the symbol (-Rp1.000, never Rp-1.000).
if (Money.formatBase(-1234567) !== '-Rp1.234.567') {
    fail('negative-sign', `expected "-Rp1.234.567", got "${Money.formatBase(-1234567)}"`);
} else ok('negative-sign', 'sign precedes the symbol');

// Fail-safe: an unknown or missing base currency must fall back to IDR, never
// throw and never render a bare number.
for (const bad of [undefined, null, '', 'XXX', 'idr ']) {
    Money.setBaseCurrency(bad);
    if (Money.baseCurrency() !== 'IDR') {
        fail('fail-safe', `setBaseCurrency(${JSON.stringify(bad)}) left base at ${Money.baseCurrency()}`);
    }
}
Money.setBaseCurrency('idr');
if (Money.baseCurrency() !== 'IDR') fail('fail-safe', 'lowercase code not normalised');
if (!failures.some((f) => f.check === 'fail-safe')) ok('fail-safe', 'unknown/absent base currency falls back to IDR');

// The invoice/bill face-currency allowlist is mirrored in firestore.rules.
// Widening it here without widening the rules produces permission-denied on save.
const RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
for (const c of Money.SUPPORTED) {
    if (!RULES.includes(`'${c}'`)) fail('rules-parity', `SUPPORTED lists ${c} but firestore.rules never mentions it`);
}
if (!failures.some((f) => f.check === 'rules-parity')) {
    ok('rules-parity', `invoice currencies [${Money.SUPPORTED.join(', ')}] present in firestore.rules`);
}

// Every country offered at onboarding must map to a supported base currency.
for (const [country, ccy] of Object.entries(Money.COUNTRY_CURRENCY)) {
    if (!Money.isSupportedBase(ccy)) fail('country-map', `${country} -> ${ccy}, which is not a supported base currency`);
    if (!Money.COUNTRY_LABELS[country]) fail('country-map', `${country} has no display label`);
}
if (!failures.some((f) => f.check === 'country-map')) {
    ok('country-map', `${Object.keys(Money.COUNTRY_CURRENCY).length} countries map to supported base currencies`);
}

// --- B. no hardcoded currency on a finance surface --------------------------
//
// Scope note — these files are DELIBERATELY on hardcoded IDR and are excluded:
//   billing-config / checkout / internal-dashboard / investor
//       FluxyOS's own billing and internal ops. A Philippine workspace still
//       pays its subscription in rupiah; these must NOT follow base currency.
//   dashboard-i18n
//       The Bahasa dictionary. Its money PATTERNS are Rp-shaped by nature —
//       tracked as a deferred item, see docs/PROJECT_BACKGROUND.md §4.
//   money-format
//       The seam itself.
const EXCLUDE = [
    'money-format.js', 'billing-config.js', 'internal-dashboard.js',
    'investor.js', 'checkout.js', 'dashboard-i18n.js',
];
// Marketing pages are not workspace surfaces — they advertise IDR pricing.
const EXCLUDE_HTML = ['onboarding.html', 'pricing.html'];

let offenders = [];
try {
    // -I skips binaries; the pattern catches concatenation, interpolation and
    // bare literals like 'Rp0'. Function NAMES (formatRp) are intentionally not
    // matched — they are identifiers, not output.
    const out = execSync(
        `grep -rnE "'Rp' *\\+|\\"Rp\\" *\\+|Rp\\\\\\$\\{|['\\"\\\`]Rp[0-9]" ` +
        `assets/js/*.js *.html 2>/dev/null || true`,
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
    );
    offenders = out.split('\n')
        .filter(Boolean)
        .filter((l) => !EXCLUDE.some((f) => l.startsWith(`assets/js/${f}:`)))
        .filter((l) => !EXCLUDE_HTML.some((f) => l.startsWith(`${f}:`)))
        // drop comment lines — a doc example is not a render site
        .filter((l) => !/^[^:]+:\d+:\s*(\/\/|\*|<!--)/.test(l));
} catch (e) {
    fail('no-literals', `grep failed: ${e.message}`);
}

if (offenders.length) {
    fail('no-literals',
        `${offenders.length} hardcoded currency literal(s) on a workspace finance surface:\n` +
        offenders.map((l) => `        ${l}`).join('\n') +
        `\n\n      Route them through the seam: window.FluxyMoney.formatBase(minorUnits).` +
        `\n      If the value is genuinely FluxyOS's own IDR billing, add the file to` +
        `\n      EXCLUDE in this check with a one-line reason.`);
} else {
    ok('no-literals', 'every workspace finance surface renders through the seam');
}

// Every app page must LOAD the seam, or its formatters throw at render time.
const appPages = fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.html'))
    .filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('sidebar-loader.js'));
const missing = appPages.filter((f) => !fs.readFileSync(path.join(ROOT, f), 'utf8').includes('money-format.js'));
if (missing.length) {
    fail('seam-loaded', `${missing.length} app page(s) never load money-format.js: ${missing.join(', ')}`);
} else {
    ok('seam-loaded', `all ${appPages.length} app pages load the seam`);
}

// --- report -----------------------------------------------------------------
if (failures.length) {
    console.error('\nMONEY SEAM\n');
    for (const f of failures) console.error(`  ✗ ${f.check}: ${f.msg}\n`);
    console.error(`${failures.length} issue(s). A currency bug does not throw — it renders a`);
    console.error('plausible wrong number, so this check is the only thing that sees it.\n');
    process.exit(1);
}
console.log('money seam: clean');
console.log(notes.join('\n'));
