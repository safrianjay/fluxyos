#!/usr/bin/env node
/**
 * Colour-vision safety check for multi-colour charts.
 *
 * docs/DESIGN_SYSTEM.md requires this before shipping any new multi-colour
 * chart: "Status green vs red is ΔE 3.7 under deuteranopia — effectively
 * identical. Run node scripts/validate_palette.js "<hex,hex>" before shipping
 * any new multi-colour chart rather than eyeballing it."
 *
 * Simulates dichromatic vision (Viénot/Brettel/Mollon 1999 LMS projection) for
 * deuteranopia, protanopia and tritanopia, then measures CIEDE2000 ΔE between
 * every pair. Pairs that collapse below the threshold are reported: those need a
 * text label and a surface gap so identity is never colour-alone.
 *
 * Usage:
 *   node scripts/validate_palette.js "#3B82F6,#0EA5E9,#6366F1"
 *   node scripts/validate_palette.js "#3B82F6,#0EA5E9" --min 12
 *
 * Exit code 1 when a pair falls below the threshold, so it can gate a build.
 */

'use strict';

// A ΔE below this reads as "the same colour" to a dichromat at chart-swatch size.
const DEFAULT_MIN_DELTA_E = 10;

function parseHex(hex) {
    const clean = String(hex).trim().replace(/^#/, '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Not a hex colour: "${hex}"`);
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

const toLinear = c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const fromLinear = v => {
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(s * 255)));
};

// sRGB (linear) → CIE XYZ, D65.
function rgbToXyz([r, g, b]) {
    const [R, G, B] = [toLinear(r), toLinear(g), toLinear(b)];
    return [
        R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
        R * 0.2126729 + G * 0.7151522 + B * 0.0721750,
        R * 0.0193339 + G * 0.1191920 + B * 0.9503041
    ];
}

function xyzToLab([x, y, z]) {
    // D65 reference white.
    const ref = [0.95047, 1.0, 1.08883];
    const f = t => t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29;
    const [fx, fy, fz] = [f(x / ref[0]), f(y / ref[1]), f(z / ref[2])];
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rgbToLab = rgb => xyzToLab(rgbToXyz(rgb));

/**
 * Dichromacy simulation, Viénot–Brettel–Mollon (1999).
 *
 * Applied as a direct linear-sRGB projection rather than a round trip through
 * LMS. The LMS form drives light, saturated blues out of gamut, and naively
 * clamping the result collapses every pale blue onto the same corner colour —
 * an artifact that would report false confusions for palettes a real dichromat
 * separates perfectly well by lightness.
 */
const DICHROMAT_MATRICES = {
    protanopia: [
        [0.11238, 0.88762, 0.00000],
        [0.11238, 0.88762, 0.00000],
        [0.00401, -0.00401, 1.00000]
    ],
    deuteranopia: [
        [0.29275, 0.70725, 0.00000],
        [0.29275, 0.70725, 0.00000],
        [-0.02234, 0.02234, 1.00000]
    ],
    tritanopia: [
        [1.00000, 0.14461, -0.14461],
        [0.00000, 1.00000, 0.00000],
        [0.00000, 0.85159, 0.14841]
    ]
};

function simulate(rgb, type) {
    const m = DICHROMAT_MATRICES[type];
    if (!m) return rgb.slice();
    const [R, G, B] = rgb.map(toLinear);
    return m.map(row => fromLinear(row[0] * R + row[1] * G + row[2] * B));
}

/** CIEDE2000 colour difference. */
function deltaE2000(lab1, lab2) {
    const [L1, a1, b1] = lab1;
    const [L2, a2, b2] = lab2;
    const kL = 1, kC = 1, kH = 1;
    const rad = Math.PI / 180, deg = 180 / Math.PI;

    const C1 = Math.hypot(a1, b1);
    const C2 = Math.hypot(a2, b2);
    const Cbar = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
    const a1p = (1 + G) * a1;
    const a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1);
    const C2p = Math.hypot(a2p, b2);
    const h1p = (Math.atan2(b1, a1p) * deg + 360) % 360;
    const h2p = (Math.atan2(b2, a2p) * deg + 360) % 360;

    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) {
        dhp = h2p - h1p;
        if (dhp > 180) dhp -= 360;
        else if (dhp < -180) dhp += 360;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);

    const Lbp = (L1 + L2) / 2;
    const Cbp = (C1p + C2p) / 2;
    let hbp;
    if (C1p * C2p === 0) hbp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
    else hbp = (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2;

    const T = 1
        - 0.17 * Math.cos((hbp - 30) * rad)
        + 0.24 * Math.cos(2 * hbp * rad)
        + 0.32 * Math.cos((3 * hbp + 6) * rad)
        - 0.20 * Math.cos((4 * hbp - 63) * rad);
    const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
    const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
    const Sc = 1 + 0.045 * Cbp;
    const Sh = 1 + 0.015 * Cbp * T;
    const Rt = -Math.sin(2 * dTheta * rad) * Rc;

    return Math.sqrt(
        Math.pow(dLp / (kL * Sl), 2) +
        Math.pow(dCp / (kC * Sc), 2) +
        Math.pow(dHp / (kH * Sh), 2) +
        Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh))
    );
}

const toHex = rgb => '#' + rgb.map(c => c.toString(16).padStart(2, '0').toUpperCase()).join('');

function main() {
    const args = process.argv.slice(2);
    const minIndex = args.indexOf('--min');
    const minDeltaE = minIndex >= 0 ? Number(args[minIndex + 1]) : DEFAULT_MIN_DELTA_E;
    const listArg = args.filter((a, i) => minIndex < 0 ? true : (i !== minIndex && i !== minIndex + 1))[0];

    if (!listArg) {
        console.error('Usage: node scripts/validate_palette.js "#3B82F6,#0EA5E9,#6366F1" [--min 10]');
        process.exit(2);
    }

    let colors;
    try {
        colors = listArg.split(',').map(s => s.trim()).filter(Boolean).map(hex => ({
            hex: '#' + String(hex).replace(/^#/, '').toUpperCase(),
            rgb: parseHex(hex)
        }));
    } catch (err) {
        console.error(err.message);
        process.exit(2);
    }

    if (colors.length < 2) {
        console.error('Need at least two colours to compare.');
        process.exit(2);
    }

    const visions = ['normal', 'deuteranopia', 'protanopia', 'tritanopia'];
    const failures = [];

    console.log(`\nPalette: ${colors.map(c => c.hex).join(' ')}`);
    console.log(`Threshold: ΔE2000 ≥ ${minDeltaE}\n`);

    for (const vision of visions) {
        const seen = colors.map(c => ({
            hex: c.hex,
            lab: rgbToLab(vision === 'normal' ? c.rgb : simulate(c.rgb, vision)),
            asSeen: vision === 'normal' ? c.hex : toHex(simulate(c.rgb, vision))
        }));

        let worst = { d: Infinity, a: null, b: null };
        for (let i = 0; i < seen.length; i++) {
            for (let j = i + 1; j < seen.length; j++) {
                const d = deltaE2000(seen[i].lab, seen[j].lab);
                if (d < worst.d) worst = { d, a: seen[i], b: seen[j] };
                if (d < minDeltaE) {
                    failures.push({ vision, a: seen[i], b: seen[j], d });
                }
            }
        }
        const status = worst.d >= minDeltaE ? 'PASS' : 'FAIL';
        console.log(
            `${status.padEnd(5)} ${vision.padEnd(13)} closest pair ΔE ${worst.d.toFixed(1)}  ` +
            `${worst.a.hex} vs ${worst.b.hex}` +
            (vision === 'normal' ? '' : `  (seen as ${worst.a.asSeen} / ${worst.b.asSeen})`)
        );
    }

    if (failures.length) {
        console.log('\nPairs below threshold — these must not rely on colour alone.');
        console.log('Give each a text label and a surface gap (DESIGN_SYSTEM.md §4b):\n');
        for (const f of failures) {
            console.log(`  ${f.vision.padEnd(13)} ${f.a.hex} vs ${f.b.hex}  ΔE ${f.d.toFixed(1)}`);
        }
        console.log('');
        process.exit(1);
    }

    console.log('\nAll pairs separable under every simulated vision type.\n');
}

main();
