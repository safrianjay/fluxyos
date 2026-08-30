'use strict';

// =============================================================================
// Every function's CORS allowlist comes from ONE list.
//
// Ten functions each carried their own hardcoded array before 2026-08-30, and
// they had already drifted — different localhost ports, for no recorded reason.
// Adding a third production origin meant editing ten files by hand, and missing
// one produces a function that works from the dashboard and returns an opaque
// CORS error from the till, at a counter, mid-service.
//
// This check is the reason that cannot happen again. It also pins the three
// places the origin list is mirrored into systems that cannot share code:
//
//   netlify/functions/lib/allowed-origins.js   function CORS   (this list)
//   cors.json                                  Firebase Storage CORS
//   netlify.toml                               the CSP the browser enforces
//
// Run: node tests/allowed-origins.check.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FN_DIR = path.join(ROOT, 'netlify', 'functions');

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

const { PRODUCTION_ORIGINS, isAllowedOrigin } =
    require(path.join(FN_DIR, 'lib', 'allowed-origins.js'));

console.log('\nallowed origins\n');

// --- 1. no function keeps its own production-origin array ------------------
const offenders = [];
for (const file of fs.readdirSync(FN_DIR).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(FN_DIR, file), 'utf8');
    // An ARRAY literal containing a fluxyos.com origin is the shape being
    // banned. A bare fallback string (`: 'https://dashboard.fluxyos.com'`) is
    // fine — that is the default Access-Control-Allow-Origin, not an allowlist.
    if (/=\s*\[[^\]]*'https:\/\/[a-z.]*fluxyos\.com'/s.test(src)) offenders.push(file);
}
if (offenders.length) {
    fail(`function(s) still declaring their own origin array: ${offenders.join(', ')}\n`
        + "      Import { ALLOWED_ORIGINS } from './lib/allowed-origins' instead.");
} else {
    ok('no function declares its own production-origin array');
}

// --- 2. the till origin is actually allowed --------------------------------
// The whole point of the consolidation. If this fails, every API call from
// pos.fluxyos.com is refused by CORS.
if (!isAllowedOrigin('https://pos.fluxyos.com')) {
    fail('https://pos.fluxyos.com is not in the allowlist — every till API call would be refused');
} else {
    ok('the till origin is allowed');
}

// --- 3. fails closed -------------------------------------------------------
for (const bad of ['https://fluxyos.com.evil.test', 'https://evil.test', '', null, '*']) {
    if (isAllowedOrigin(bad)) fail(`isAllowedOrigin(${JSON.stringify(bad)}) returned true — the check is not failing closed`);
}
if (!failures) ok('unknown and empty origins are refused');

// --- 4. Firebase Storage CORS agrees --------------------------------------
// cors.json is enforced by Google, not by our code, and deploys separately
// (`gsutil cors set`). A production origin missing here fails only on upload
// and download — receipts, KYC documents — which is exactly the kind of thing
// nobody exercises until a customer does.
const corsPath = path.join(ROOT, 'cors.json');
if (fs.existsSync(corsPath)) {
    const cors = JSON.parse(fs.readFileSync(corsPath, 'utf8'));
    const listed = new Set((cors[0] && cors[0].origin) || []);
    const missing = PRODUCTION_ORIGINS.filter((o) => !listed.has(o));
    if (missing.length) {
        fail(`cors.json is missing production origin(s): ${missing.join(', ')}\n`
            + '      Storage uploads/downloads from there will fail. Remember it deploys\n'
            + '      separately: gsutil cors set cors.json gs://<bucket>');
    } else {
        ok('cors.json covers every production origin');
    }
}

// --- 5. the CSP frames the auth popup -------------------------------------
// authDomain is fluxyos.com, so signInWithPopup is framed from the apex on EVERY
// origin. Without this the popup is blocked and nobody can sign in to the till.
const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
const frameSrc = (toml.match(/frame-src([^;]*)/) || [])[1] || '';
if (!frameSrc.includes('https://fluxyos.com')) {
    fail('netlify.toml frame-src no longer allows https://fluxyos.com — the Firebase auth popup would be blocked on every origin');
} else {
    ok('CSP frame-src still allows the auth popup origin');
}

if (failures) {
    console.error(`\n${failures} problem(s).\n`);
    process.exit(1);
}
console.log('\nallowed origins: clean\n');
