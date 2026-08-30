#!/usr/bin/env node
'use strict';

// =============================================================================
// FluxyOS — strip comments from firestore.rules for deployment
//
// THE PROBLEM THIS SOLVES.
//
// `firestore.rules` is uploaded as SOURCE TEXT, and the release endpoint on this
// project refuses somewhere around 218,000 bytes — with an opaque 400 while
// `--dry-run` still reports success. The file sits at ~211 KB, and **22.7% of it
// is comments**. Those comments are not decoration: they record production
// incidents, the reasoning behind each validator, and the traps that have
// already cost this project a bisect. Deleting them to make room would trade a
// deploy problem for an institutional-memory problem.
//
// So they are not deleted. They are stripped at DEPLOY time, and the repository
// keeps the fully-commented file as the source of truth.
//
// `POS_IMPLEMENTATION_PLAN.md` proposed collapsing create/update validator pairs
// instead — "real work with real risk". This is the cheaper lever and it was
// missed: it recovers ~47 KB (97% → 75% of ceiling) mechanically, changes no
// semantics at all, and costs nothing anyone will ever have to reason about.
//
// LINE NUMBERS ARE PRESERVED EXACTLY.
//
// A comment line becomes an EMPTY line rather than being removed. That costs one
// byte each (651 total, against 47,942 recovered) and buys something worth far
// more: a rules error reported at line 2749 in the Firebase console or in a
// client error points at line 2749 of the file you actually read. Compacting the
// file would make every production stack trace a lookup exercise.
//
// WHY THIS IS SAFE.
//
// A line is stripped only when its TRIMMED content starts with `//`. In Firestore
// rules syntax that is unambiguously a comment — the language has no multi-line
// strings, so no string literal can begin a line with `//`. Verified: the file
// contains no block comments (`/* */`), and the only `/*` sequences in it are
// inside `//` comments describing collection paths.
//
// The output is checked against a strict invariant before it is written: for
// every line, the built line is either IDENTICAL to the source line, or the
// source line was a comment and the built line is empty. Nothing else is
// possible, and the script refuses to write if it is.
//
// Usage:
//   npm run rules:build     build only, print the size report
//   npm run rules:deploy    build, then deploy the built file
//   npm run rules:test      build, then run the emulator suite against the BUILT
//                           file — parity proof, not a formality
//
// The build output is generated and gitignored. It is never edited by hand and
// never committed; `firestore.rules` is the only file anyone touches.
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'firestore.rules');
const OUT_DIR = path.join(ROOT, '.rules-build');
const OUT = path.join(OUT_DIR, 'firestore.rules');
const OUT_CONFIG = path.join(OUT_DIR, 'firebase.json');

// The size the release endpoint has been observed to accept on this project.
// Mirrored in tests/deploy-stamp.check.js.
const CEILING = 218_000;

function fail(msg) {
    console.error(`[build-rules] ERROR: ${msg}`);
    process.exit(1);
}

function stripComments(src) {
    return src.split('\n')
        .map((line) => (line.trim().startsWith('//') ? '' : line))
        .join('\n');
}

// The invariant, asserted rather than assumed. If this ever fails the transform
// has done something other than blank a comment, and no output is written.
function verify(srcText, outText) {
    const a = srcText.split('\n');
    const b = outText.split('\n');
    if (a.length !== b.length) {
        fail(`line count changed (${a.length} → ${b.length}); line numbers would no longer match`);
    }
    for (let i = 0; i < a.length; i += 1) {
        if (b[i] === a[i]) continue;
        if (a[i].trim().startsWith('//') && b[i] === '') continue;
        fail(
            `line ${i + 1} was altered in a way that is not a comment blank:\n`
            + `      source: ${JSON.stringify(a[i])}\n`
            + `      built:  ${JSON.stringify(b[i])}`
        );
    }
}

function main() {
    if (!fs.existsSync(SRC)) fail('firestore.rules not found');
    const srcText = fs.readFileSync(SRC, 'utf8');
    const outText = stripComments(srcText);
    verify(srcText, outText);

    const before = Buffer.byteLength(srcText);
    const after = Buffer.byteLength(outText);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT, outText);

    // A config beside the built file so `firebase --config .rules-build/firebase.json`
    // resolves `firestore.rules` to the BUILT one. Emulator ports mirror the root
    // config so `rules:test` exercises the built file through the same harness the
    // specs expect.
    fs.writeFileSync(OUT_CONFIG, `${JSON.stringify({
        firestore: { rules: 'firestore.rules' },
        emulators: {
            firestore: { port: 8080 },
            auth: { port: 9099 },
            ui: { enabled: false }
        }
    }, null, 2)}\n`);

    // `--config` re-roots the firebase CLI's project directory, so `.firebaserc`
    // at the repo root is no longer found and the deploy fails with "No currently
    // active project". Copy it rather than hardcoding the project id here — one
    // source of truth for which project this deploys to.
    const rc = path.join(ROOT, '.firebaserc');
    if (!fs.existsSync(rc)) fail('.firebaserc not found — the deploy would have no project');
    fs.copyFileSync(rc, path.join(OUT_DIR, '.firebaserc'));

    const pct = Math.round((after / CEILING) * 100);
    const pctBefore = Math.round((before / CEILING) * 100);
    console.log(`[build-rules] ${before.toLocaleString()} → ${after.toLocaleString()} bytes`
        + `  (${(before - after).toLocaleString()} of comments stripped)`);
    console.log(`[build-rules] ceiling use: ${pctBefore}% → ${pct}% of ${CEILING.toLocaleString()}`);
    console.log(`[build-rules] line numbers preserved (${srcText.split('\n').length.toLocaleString()} lines)`);

    if (after > CEILING) {
        fail(`the BUILT file is still ${after.toLocaleString()} bytes, past the ~${CEILING.toLocaleString()} `
            + 'the release endpoint accepts. Comments are no longer the problem — the rules themselves are.');
    }
    console.log(`[build-rules] wrote ${path.relative(ROOT, OUT)}`);
}

main();
