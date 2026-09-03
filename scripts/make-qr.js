#!/usr/bin/env node
'use strict';
// =============================================================================
// Build-time QR generator for the event page.
//
// Generated once and committed as a static SVG: the URL is fixed, the page is
// served under a CSP that blocks external scripts, and a printed sign must not
// depend on anything running at view time.
//
// Error correction level H (30% recovery) is not a style choice. The centre logo
// destroys modules, and H is the only level with enough redundancy to survive
// covering ~14% of the symbol. The knockout is deliberately kept well under the
// 30% ceiling — recovery capacity is also what absorbs print smudges, bad
// lighting and a phone held at an angle, which is the actual operating
// environment.
//
// Output is verified by decoding it back with macOS Vision (scripts/verify-qr.sh)
// WITH the logo composited. An unverified QR fails silently, in front of people.
//
// Usage: node scripts/make-qr.js [url] > assets/images/qr-event.svg
// =============================================================================
const QRCode = require('qrcode');
// The logo overlay lives in one place now — netlify/functions/pos-table-qr.js
// needed the identical knockout for table cards, and the thing that drifts
// between two copies is the ratio between the knockout and the error-correction
// budget. That is not a style value: it is the difference between a card that
// scans and one that does not.
const { withLogo, logoPercent, LOGO_ECC } = require('../netlify/functions/lib/qr-logo.js');

const URL = process.argv[2] || 'https://fluxyos.com/event';

QRCode.create(URL, { errorCorrectionLevel: LOGO_ECC });   // throws early on bad input

QRCode.toString(URL, {
    type: 'svg',
    errorCorrectionLevel: LOGO_ECC,
    margin: 4,                 // spec-minimum quiet zone; below this, scanners struggle
    color: { dark: '#0B0F19', light: '#FFFFFF' },
}).then((svg) => {
    const out = withLogo(svg);
    const dim = parseFloat(out.match(/viewBox="0 0 (\d+(?:\.\d+)?) /)[1]);
    process.stdout.write(out);
    process.stderr.write(`  ${URL}  ${dim}x${dim} modules  ecc ${LOGO_ECC}  logo ${logoPercent().toFixed(1)}% of side\n`);
}).catch((e) => { console.error('qr generation failed:', e.message); process.exit(1); });
