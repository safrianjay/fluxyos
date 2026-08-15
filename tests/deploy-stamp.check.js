'use strict';

// =============================================================================
// FluxyOS — deploy-precondition check (no network, no credentials)
//
// `git push` ships the site through Netlify. It does NOT ship firestore.rules,
// firestore.indexes.json, or storage.rules — those are separate manual Firebase
// commands, and the order is unforgiving.
//
// The failure this exists to prevent, from 2026-08-16: a change added a new
// collection to the posting path. Firestore batch writes are atomic, so with the
// rules not yet live, EVERY posting in production would have failed —
// transactions, bills, invoices, payments. Full QA was green, because nothing
// knew the code had an unmet deploy precondition. The rule had been written down
// in eight separate documents and enforced in none of them.
//
// This compares each artifact against the hash recorded when it was last
// deployed (`deploy/deployed-stamps.json`, written by `npm run deploy:stamp`).
// A mismatch means: deploy, verify the deploy, stamp, then push.
//
// Deliberately credential-free. Asking the Firebase API what is live would be
// more direct, but it would make QA fail for any contributor without production
// access — turning a safety check into an obstacle. A committed hash is a claim
// a human made after deploying, which is the same trust model as the QA artifact
// the push gate already relies on.
// =============================================================================

const fs = require('fs');
const path = require('path');
const { ARTIFACTS, sha256, readStamps } = require('../scripts/stamp-deploy.js');

const REPO_ROOT = path.resolve(__dirname, '..');

function main() {
    const stamps = readStamps().artifacts || {};
    const problems = [];
    const ok = [];

    for (const [file, deployCmd] of Object.entries(ARTIFACTS)) {
        if (!fs.existsSync(path.join(REPO_ROOT, file))) continue;
        const hash = sha256(file);
        const stamped = (stamps[file] || {}).sha256;

        if (!stamped) {
            problems.push(
                `${file}: never stamped.\n` +
                `      If it is already deployed:  npm run deploy:stamp\n` +
                `      If it is not:               ${deployCmd}   (then stamp)`
            );
            continue;
        }
        if (stamped !== hash) {
            problems.push(
                `${file}: changed since it was last deployed (${(stamps[file].stamped_at || '?')}).\n` +
                `      stamped ${stamped.slice(0, 12)} · working tree ${hash.slice(0, 12)}\n` +
                `      Pushing code that depends on this WILL break production — these\n` +
                `      files do not ship with git push, and batch writes are atomic.\n` +
                `        1. ${deployCmd}\n` +
                `        2. verify it actually took (run a spec that exercises the new path)\n` +
                `        3. npm run deploy:stamp && commit the stamp`
            );
            continue;
        }
        ok.push(`${file} (stamped ${stamps[file].stamped_at})`);
    }

    if (problems.length) {
        console.error('\nDEPLOY PRECONDITION NOT MET\n');
        for (const p of problems) console.error(`  ✗ ${p}\n`);
        console.error('These artifacts deploy separately from git push. See CLAUDE.md.\n');
        process.exit(1);
    }
    console.log('deploy preconditions: clean');
    for (const o of ok) console.log(`  ✓ ${o}`);
}

main();
