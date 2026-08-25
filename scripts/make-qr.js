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

const URL = process.argv[2] || 'https://fluxyos.com/event';

QRCode.create(URL, { errorCorrectionLevel: 'H' });   // throws early on bad input

QRCode.toString(URL, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 4,                 // spec-minimum quiet zone; below this, scanners struggle
    color: { dark: '#0B0F19', light: '#FFFFFF' },
}).then((svg) => {
    // qrcode emits a viewBox in module units — read it so the logo is sized
    // relative to the symbol rather than to a hardcoded pixel guess.
    const vb = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) /);
    const dim = vb ? parseFloat(vb[1]) : 41;

    // ~14% of the symbol area. Comfortably inside H's budget.
    const box = dim * 0.24;
    const pos = (dim - box) / 2;
    const pad = box * 0.14;
    const logo = box - pad * 2;
    const s = logo / 40;        // favicon.svg is a 40x40 artboard

    const overlay =
`  <rect x="${(pos - box * 0.06).toFixed(3)}" y="${(pos - box * 0.06).toFixed(3)}" width="${(box * 1.12).toFixed(3)}" height="${(box * 1.12).toFixed(3)}" rx="${(box * 0.22).toFixed(3)}" fill="#FFFFFF"/>
  <g transform="translate(${(pos + pad).toFixed(3)} ${(pos + pad).toFixed(3)}) scale(${s.toFixed(5)})">
    <rect width="40" height="40" rx="8" fill="#0B0F19"/>
    <g transform="translate(1.5, 0)">
      <path d="M 7 6 L 33 6 L 27 12 L 13 12 L 13 34 L 7 34 Z" fill="#FFFFFF"/>
      <path d="M 17 18 L 27 18 L 21 24 L 17 24 Z" fill="#FFFFFF"/>
    </g>
  </g>
`;
    process.stdout.write(svg.replace('</svg>', overlay + '</svg>'));
    process.stderr.write(`  ${URL}  ${dim}x${dim} modules  ecc H  logo ${(box / dim * 100).toFixed(1)}% of side\n`);
}).catch((e) => { console.error('qr generation failed:', e.message); process.exit(1); });
