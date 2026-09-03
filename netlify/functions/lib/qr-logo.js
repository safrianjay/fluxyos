'use strict';

// =============================================================================
// The FluxyOS "F" knocked into the centre of a QR symbol.
//
// ONE IMPLEMENTATION, TWO CALLERS. `scripts/make-qr.js` (the event poster) had
// this inline; `netlify/functions/pos-table-qr.js` (table cards) needed the
// same thing. A second copy would drift, and the thing that drifts here is the
// ratio between the knockout and the error-correction budget — which is not a
// style value. It is the difference between a card that scans and one that does
// not, and nothing about a wrong answer looks wrong.
//
// ⚠️ THE KNOCKOUT DESTROYS MODULES. Covering the centre of a QR code deletes
// data, and the only reason the symbol still reads is Reed-Solomon recovery.
// That is why a logo forces error correction **H (30%)**: the geometry below is
// sized to sit well inside that budget, and the remaining headroom is what
// absorbs print smudges, glare and a phone held at an angle — the actual
// operating environment for a laminated card on a restaurant table.
//
// Never raise LOGO_FRACTION without re-running the decode round trip in
// `tests/pos-table-qr.check.js`. It composites the logo and decodes with
// Apple's Vision framework, which is the only check that can tell you the
// symbol has stopped being readable.
// =============================================================================

// The logo box as a fraction of the symbol's side. 0.24 of the side is ~5.8% of
// the area; with the white backing plate below it reaches ~7.2%. Comfortably
// inside H's 30% budget, and proven by decode rather than by arithmetic.
const LOGO_FRACTION = 0.24;

// The error correction a logo REQUIRES. Exported so callers state the
// dependency rather than each remembering it.
const LOGO_ECC = 'H';

/**
 * Composite the F-logo into the centre of a `qrcode`-generated SVG string.
 *
 * @param {string} svg  SVG from QRCode.toString({ type: 'svg' })
 * @returns {string}    the same SVG with the logo before </svg>
 */
function withLogo(svg) {
    // The viewBox is in MODULE units, so the logo is sized relative to the
    // symbol rather than to a pixel guess that breaks when the URL length
    // changes the version.
    const vb = String(svg).match(/viewBox="0 0 (\d+(?:\.\d+)?) /);
    if (!vb) throw new Error('qr-logo: SVG has no viewBox — cannot size the logo to the symbol');
    const dim = parseFloat(vb[1]);

    const box = dim * LOGO_FRACTION;
    const pos = (dim - box) / 2;
    const pad = box * 0.14;
    const logo = box - pad * 2;
    const s = logo / 40;        // favicon.svg is a 40x40 artboard

    // A white plate under the mark. Without it the logo sits on live modules
    // and a scanner sees a smear rather than a clean knockout.
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
    return String(svg).replace('</svg>', overlay + '</svg>');
}

/** Module-side percentage the logo occupies — for logging and assertions. */
function logoPercent() { return LOGO_FRACTION * 100; }

module.exports = { withLogo, logoPercent, LOGO_FRACTION, LOGO_ECC };
