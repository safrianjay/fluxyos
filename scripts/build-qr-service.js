#!/usr/bin/env node
'use strict';
// =============================================================================
// Assemble the Cloud Run bundle for the QR diner functions → .qr-service/
//
// The service (services/qr/server.js) calls the SAME handlers Netlify runs, so
// this copies them in unchanged, at the same relative paths their require()s
// expect (`./lib/…`, `../../assets/js/pos-pricing.js`). Nothing here is edited
// by hand; re-run it before every deploy.
//
//   node scripts/build-qr-service.js
//   gcloud run deploy qr-diner --source .qr-service --region asia-southeast1 …
//   (the full command is in docs/perf/LOAD_2026-09-11.md)
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.qr-service');

const FILES = [
    ['services/qr/server.js', 'server.js'],
    ['services/qr/package.json', 'package.json'],
    ...['qr-menu', 'qr-menu-image', 'qr-order', 'qr-order-status', 'qr-request-bill']
        .map((f) => [`netlify/functions/${f}.js`, `netlify/functions/${f}.js`]),
    ...['allowed-origins', 'rate-limit', 'warm-cache', 'table-orders', 'warmup']
        .map((f) => [`netlify/functions/lib/${f}.js`, `netlify/functions/lib/${f}.js`]),
    ['assets/js/pos-pricing.js', 'assets/js/pos-pricing.js']
];

/**
 * One hash over every source file that goes into the bundle, in order, path
 * included. `npm run deploy:stamp` records it as the `qr-service` artifact and
 * tests/deploy-stamp.check.js compares it: a handler changed after the last
 * Cloud Run deploy blocks the push, because diners are served by Cloud Run and
 * a `git push` alone would update only the Netlify copies.
 */
function bundleHash() {
    const h = require('crypto').createHash('sha256');
    for (const [from] of FILES) {
        const abs = path.join(ROOT, from);
        if (!fs.existsSync(abs)) return null;
        h.update(from).update('\0').update(fs.readFileSync(abs)).update('\0');
    }
    return h.digest('hex');
}

function build() {
    fs.rmSync(OUT, { recursive: true, force: true });
    for (const [from, to] of FILES) {
        const src = path.join(ROOT, from);
        if (!fs.existsSync(src)) throw new Error(`missing ${from}`);
        fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true });
        fs.copyFileSync(src, path.join(OUT, to));
    }

    // Every require() in the bundle must resolve inside it (or to firebase-admin /
    // a Node built-in). A handler that gains a new ./lib dependency and is shipped
    // without it would fail only in production, on the first diner.
    const BUILTIN = new Set(require('module').builtinModules);
    const missing = [];
    for (const [, to] of FILES.filter(([f]) => f.endsWith('.js'))) {
        const file = path.join(OUT, to);
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
            const spec = m[1];
            if (BUILTIN.has(spec) || spec === 'firebase-admin' || spec.startsWith('firebase-admin/')) continue;
            if (!spec.startsWith('.')) { missing.push(`${to}: ${spec} (not a dependency)`); continue; }
            const target = path.resolve(path.dirname(file), spec);
            if (![target, `${target}.js`].some((p) => fs.existsSync(p))) missing.push(`${to}: ${spec}`);
        }
    }
    if (missing.length) {
        console.error('[build-qr-service] ✗ unresolved requires in the bundle:\n  ' + missing.join('\n  '));
        process.exit(1);
    }
    console.log(`[build-qr-service] ${FILES.length} files → ${path.relative(ROOT, OUT)}/ (every require resolves)`);
}

if (require.main === module) build();

module.exports = { FILES, bundleHash, OUT };
