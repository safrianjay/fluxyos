#!/usr/bin/env node
/**
 * Record which deploy-gated artifacts are live.
 *
 * Three files in this repo do NOT ship with `git push` — Netlify deploys the
 * site, but Firebase rules and indexes are a separate manual command:
 *
 *   firestore.rules        firebase deploy --only firestore:rules
 *   firestore.indexes.json firebase deploy --only firestore:indexes
 *   storage.rules          firebase deploy --only storage
 *
 * Ordering matters and is unforgiving. On 2026-08-16 a change that wrote a new
 * collection was one push away from breaking EVERY posting in production —
 * transactions, bills, invoices, payments — because Firestore batch writes are
 * atomic and the rules for that collection were not live yet. QA was green: no
 * check knew the code had an unmet deploy precondition.
 *
 * The ordering rule was already written down in at least eight documents. It was
 * enforced by none of them, which is the recurring shape of this problem here.
 *
 * USAGE — after deploying, record what is now live:
 *
 *   npm run deploy:stamp
 *
 * `tests/deploy-stamp.check.js` then fails the QA BE lane whenever one of these
 * files differs from its stamp, i.e. whenever the working tree expects a deploy
 * that has not happened. Commit the stamp alongside the change it describes.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const STAMP_FILE = path.join(REPO_ROOT, 'deploy', 'deployed-stamps.json');

const ARTIFACTS = {
    'firestore.rules': 'firebase deploy --only firestore:rules',
    'firestore.indexes.json': 'firebase deploy --only firestore:indexes',
    'storage.rules': 'firebase deploy --only storage',
};

function sha256(file) {
    const abs = path.join(REPO_ROOT, file);
    if (!fs.existsSync(abs)) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function readStamps() {
    if (!fs.existsSync(STAMP_FILE)) return { _comment: [], artifacts: {} };
    try { return JSON.parse(fs.readFileSync(STAMP_FILE, 'utf8')); } catch (_) { return { artifacts: {} }; }
}

function main() {
    const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
    const stamps = readStamps();
    stamps._comment = [
        'Hash of each deploy-gated artifact AS LAST DEPLOYED. Written by',
        '`npm run deploy:stamp`, verified by tests/deploy-stamp.check.js in the QA',
        'BE lane. A mismatch means the working tree expects a Firebase deploy that',
        'has not happened — push that code and it can break production, because',
        'these files do NOT ship with git push.',
        '',
        'Only ever run the stamp command AFTER the deploy actually succeeded, and',
        'verify the deploy rather than trusting the console: the failure mode here',
        'is silent until a real write hits the new path.',
    ];
    stamps.artifacts = stamps.artifacts || {};

    const targets = only.length ? only : Object.keys(ARTIFACTS);
    let changed = 0;
    for (const file of targets) {
        if (!(file in ARTIFACTS)) {
            console.error(`unknown artifact: ${file}`);
            process.exit(1);
        }
        const hash = sha256(file);
        if (!hash) { console.log(`  skip     ${file} (not present)`); continue; }
        const prev = (stamps.artifacts[file] || {}).sha256;
        stamps.artifacts[file] = { sha256: hash, stamped_at: new Date().toISOString().slice(0, 10) };
        if (prev === hash) console.log(`  same     ${file}`);
        else { console.log(`  stamped  ${file}  ${(prev || 'none').slice(0, 12)} → ${hash.slice(0, 12)}`); changed += 1; }
    }

    fs.mkdirSync(path.dirname(STAMP_FILE), { recursive: true });
    fs.writeFileSync(STAMP_FILE, `${JSON.stringify(stamps, null, 2)}\n`);
    console.log(changed ? `\n${changed} stamp(s) updated — commit deploy/deployed-stamps.json.` : '\nNo change.');
}

// Only stamp when invoked directly. `tests/deploy-stamp.check.js` requires this
// module for ARTIFACTS/sha256/readStamps — without this guard the check would
// RE-STAMP on load and then verify its own fresh output, so it could never
// fail. Caught by mutation-testing the check; it had looked green.
if (require.main === module) main();

module.exports = { ARTIFACTS, sha256, readStamps, STAMP_FILE };
