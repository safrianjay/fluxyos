'use strict';

// =============================================================================
// Every Firestore handle comes from ONE initializer.
//
// `initializeFirestore(app, { experimentalForceLongPolling: true })` can run
// only once per app, and the FIRST Firestore touch on a page decides the
// transport for everything after it. So a single module reaching for a bare
// `getFirestore(app)` — anywhere, on any page — is enough to put the whole app
// back on the streaming WebChannel that ad blockers, Brave Shields and corporate
// proxies break.
//
// The symptom is not a crash. It is a 400 on `/Listen/channel`, a stream that
// retries forever, and writes that take seconds — reported on 2026-09-01 as
// "there is an error, and creating an order takes a long time". The offender was
// `feature-access.js`, one read on a member's page.
//
// Run: node tests/firestore-transport.check.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'assets', 'js');
const INITIALIZER = 'firestore-db.js';

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

console.log('\nfirestore transport\n');

// --- 1. the initializer still forces long polling --------------------------
const init = fs.readFileSync(path.join(JS_DIR, INITIALIZER), 'utf8');
if (!/experimentalForceLongPolling:\s*true/.test(init)) {
    fail(`${INITIALIZER} no longer forces long polling — every blocked network is now a silent "0 data"`);
} else {
    ok('the shared initializer forces long polling');
}

// --- 2. nobody else calls getFirestore -------------------------------------
// Comments are stripped first: the modules that route correctly EXPLAIN why they
// do, and those explanations name the very call being banned.
const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const offenders = [];
for (const file of fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js') && f !== INITIALIZER)) {
    const src = stripComments(fs.readFileSync(path.join(JS_DIR, file), 'utf8'));
    if (/\bgetFirestore\s*\(/.test(src)) offenders.push(file);
}

if (offenders.length) {
    fail(`bare getFirestore() in: ${offenders.join(', ')}\n`
        + '      Import { resolveDb } from ./firestore-db.js and call resolveDb(app).\n'
        + '      Whichever module touches Firestore FIRST decides the transport for the\n'
        + '      whole page — one bare call undoes long polling everywhere.');
} else {
    ok('no module bypasses the shared initializer');
}

if (failures) {
    console.error(`\n${failures} problem(s).\n`);
    process.exit(1);
}
console.log('\nfirestore transport: clean\n');
