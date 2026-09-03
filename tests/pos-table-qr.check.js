'use strict';

// =============================================================================
// The QR a restaurant prints actually scans.
//
// THIS IS THE ONE ARTEFACT IN THE PRODUCT WHOSE FAILURE IS TOTAL AND INVISIBLE.
// A wrong QR looks exactly like a right one. It is discovered by a customer,
// at a table, holding a laminated card that does nothing — and nothing anywhere
// raised an error. No amount of asserting that "an SVG was produced" catches
// that.
//
// So the real assertion here is a ROUND TRIP THROUGH A DIFFERENT
// IMPLEMENTATION: the card is encoded by `qrcode` exactly as the function does
// it, rasterised in a real browser, and decoded by **Apple's Vision framework**
// — the same decoder the customer's iPhone camera uses. Encoding and decoding
// with the same library would prove only that the library agrees with itself.
//
// `scripts/make-qr.js` has claimed since it was written that its output is
// "verified by decoding it back with macOS Vision (scripts/verify-qr.sh)".
// That script did not exist. It does now (`scripts/qr/decode-qr.swift`).
//
// The structural assertions run everywhere. The decode needs macOS and Swift,
// and it SAYS SO LOUDLY when it cannot run rather than reporting success — a
// check that quietly skips its only real assertion is worse than no check.
//
// Run: node tests/pos-table-qr.check.js
// =============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const QRCode = require(path.join(ROOT, 'node_modules/qrcode'));
const fn = require(path.join(ROOT, 'netlify/functions/pos-table-qr.js'));
const { cardUrl, ECC, MARGIN, ORDER_ORIGIN, MAY_MANAGE, CARD_MM, withLogo, logoPercent } = fn.__test;

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (actual, expected, label) => {
    if (actual === expected) ok(label);
    else fail(`${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

// A real token: 32 CSPRNG bytes, base64url, 43 characters. Matches
// `_newQrToken` in pos-service.js.
const realToken = () => require('crypto').randomBytes(32).toString('base64url');

(async () => {
    console.log('\npos table qr\n');

    // --- 1. The printed URL -------------------------------------------------
    const tok = realToken();
    is(cardUrl(tok), `https://order.fluxyos.com/t/${tok}`,
        'a card points at order.fluxyos.com/t/<token>');
    is(ORDER_ORIGIN.startsWith('https://'), true, 'the origin is https');
    // A card printed from a deploy preview must still send diners to
    // production. Deriving this from the request would laminate a URL that
    // stops existing when the preview expires.
    is(/request|event\.headers|origin\b/i.test(
        fs.readFileSync(path.join(ROOT, 'netlify/functions/pos-table-qr.js'), 'utf8')
            .split('const ORDER_ORIGIN')[1].split('\n')[0]), false,
        'the card origin is not derived from the caller');

    // --- 2. A cashier cannot print the room ---------------------------------
    is(MAY_MANAGE.includes('cashier'), false,
        'a cashier cannot mint table cards — pos.manage is finance+');
    is(MAY_MANAGE.includes('owner') && MAY_MANAGE.includes('admin')
        && MAY_MANAGE.includes('finance') && MAY_MANAGE.includes('accountant'), true,
        'every role holding pos.manage can');

    // --- 3. The symbol is readable at the size it is printed ---------------
    // H, and it is REQUIRED, not preferred: the logo knocks out the centre and
    // deletes data. Q survived a clean raster in testing, but that proves
    // nothing about margin left for glare and wear on a laminated card.
    is(ECC, 'H', 'error correction is H — the logo knockout demands it');
    is(MARGIN, 4, 'the quiet zone is the spec minimum of 4 modules');
    is(logoPercent(), 24, 'the logo is 24% of the symbol side');

    const sym = QRCode.create(cardUrl(tok), { errorCorrectionLevel: ECC });
    const modules = sym.modules.size;
    // The pitch is what a phone actually has to resolve. H costs modules; the
    // print size pays it back. 49x49 + 8 quiet = 57 across 47mm = 0.82mm — the
    // same geometry the logo-less Q version had at 40mm.
    const pitchMm = CARD_MM / (modules + MARGIN * 2);
    is(modules <= 53, true, `the symbol is ${modules}x${modules} modules (<= 53)`);
    is(pitchMm >= 0.8, true,
        `modules are ${pitchMm.toFixed(2)}mm at a ${CARD_MM}mm card (>= 0.80mm)`);

    // --- 4. THE ROUND TRIP --------------------------------------------------
    const canDecode = os.platform() === 'darwin' && (() => {
        try { execFileSync('which', ['swift'], { stdio: 'ignore' }); return true; }
        catch (_) { return false; }
    })();

    if (!canDecode) {
        // Loudly, not silently. This is the only assertion that proves a phone
        // can read the card; everything above it is arithmetic about an SVG.
        console.warn('  ⚠ SKIPPED THE DECODE ROUND TRIP — needs macOS + swift.');
        console.warn('    The structural checks above passed, but NOTHING here has');
        console.warn('    verified that the printed card actually scans.');
    } else {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxy-qr-'));
        // Two cases: a real token, and the longest label/token combination the
        // encoder will be handed. If the long one overflows a version boundary
        // it fails HERE rather than on a card.
        const cases = [
            { name: 'a real 43-character token', token: tok },
            { name: 'a maximum-length token', token: 'A'.repeat(64) }
        ];

        const { chromium } = require(path.join(ROOT, 'node_modules/@playwright/test'));
        const browser = await chromium.launch();
        try {
            for (const c of cases) {
                // Built LITERALLY here, not by calling cardUrl(). Comparing the
                // decode against cardUrl's own output would make this leg agree
                // with any bug in cardUrl — a truncated token would encode,
                // rasterise and decode perfectly, and the card would still
                // resolve to nothing. Verified: with cardUrl truncating by one
                // character, this assertion now fails and previously did not.
                const url = `https://order.fluxyos.com/t/${c.token}`;
                is(cardUrl(c.token), url, `cardUrl agrees for ${c.name}`);
                // THE LOGO IS COMPOSITED BEFORE DECODING. Verifying a bare
                // symbol would verify an artefact that is never printed, and
                // the knockout is precisely the thing that can break it.
                const svg = withLogo(await QRCode.toString(url, {
                    type: 'svg', errorCorrectionLevel: ECC, margin: MARGIN,
                    color: { dark: '#0B0F19', light: '#FFFFFF' }
                }));
                const png = path.join(tmp, `${c.token.slice(0, 8)}.png`);

                // Rasterised in a real browser, at a real print-ish resolution,
                // because that is what a printer is handed — not the module
                // matrix the encoder kept in memory.
                const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
                await page.setContent(
                    `<body style="margin:0;background:#fff">${
                        svg.replace('<svg ', '<svg width="600" height="600" ')}</body>`);
                await page.locator('svg').screenshot({ path: png });
                await page.close();

                let decoded = '';
                try {
                    decoded = execFileSync('swift',
                        [path.join(ROOT, 'scripts/qr/decode-qr.swift'), png],
                        { encoding: 'utf8' }).trim();
                } catch (_) { decoded = ''; }

                is(decoded, url, `Vision decodes ${c.name} back to the exact URL, logo and all`);
            }
        } finally {
            await browser.close();
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    }

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\npos table qr: clean\n');
    process.exit(failures ? 1 : 0);
})().catch((err) => {
    console.error('\n✗ pos-table-qr check threw:', err);
    process.exit(1);
});
