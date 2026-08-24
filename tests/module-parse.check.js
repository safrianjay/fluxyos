#!/usr/bin/env node
'use strict';
//
// Every client module must PARSE. Unconditional, because the file that fails to
// parse is not always the file you just edited — a bad merge, a partial revert,
// or an interrupted edit breaks a module nobody touched.
//
// This exists because `node --check` cannot be trusted here. On a file
// containing import/export it parses in script mode and returns 0 for code that
// is a hard SyntaxError as a module:
//
//     node --check assets/js/kyc-gate.js            -> exit 0   (broken!)
//     node --input-type=module --check < …          -> exit 1
//
// kyc-gate.js shipped to main with a missing paren on that basis. Nothing went
// red: both of its consumers import it dynamically inside a catch, so the KYC
// gate simply stopped running and users pending review were not locked. Only
// the one page importing it statically ever surfaced the error.
//
// A parse failure is never a transient condition worth failing open on, so it
// belongs at build time, not behind a runtime try/catch.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['assets/js', 'scripts', 'netlify/functions', 'functions/lib'];

const failures = [];
let checked = 0;

function isModule(src, file) {
    return file.endsWith('.mjs') || /^\s*(import|export)\s/m.test(src);
}

for (const dir of DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
        if (!/\.(js|mjs)$/.test(name)) continue;
        const rel = path.join(dir, name);
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        checked += 1;
        try {
            if (isModule(src, name)) {
                execFileSync(process.execPath, ['--input-type=module', '--check'],
                    { input: src, stdio: ['pipe', 'ignore', 'pipe'] });
            } else {
                execFileSync(process.execPath, ['--check', path.join(ROOT, rel)],
                    { stdio: ['ignore', 'ignore', 'pipe'] });
            }
        } catch (err) {
            const msg = String(err.stderr || err.message).split('\n')
                .find((l) => /SyntaxError|Error:/.test(l)) || 'parse failed';
            failures.push(`${rel}: ${msg.trim()}`);
        }
    }
}

if (failures.length) {
    console.error('module parse: FAILED\n');
    failures.forEach((f) => console.error('  ✗ ' + f));
    console.error('\n  A module that cannot parse does not throw where you can see it —');
    console.error('  every dynamic import of it lands in a catch, and the feature just');
    console.error('  stops happening. Fix the syntax; never fail open on a parse error.');
    process.exit(1);
}
console.log(`module parse: clean (${checked} files)`);
