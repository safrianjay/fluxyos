'use strict';

// =============================================================================
// A three-second blip does not fail a sale, and the banner tells the truth.
//
// THE COMPLAINT BEHIND IT. Restaurant wifi drops for SECONDS — an access point
// re-associating, not an outage. Every till mutation is a Firestore
// transaction, so a blip surfaced as an error on the tap and the cashier
// pressed Pay again with a customer waiting.
//
// ⚠️ WHY RETRYING IS SAFE, AND ONLY HERE. Firestore raises `unavailable` when
// the client could not REACH the backend, so the transaction did not commit and
// re-running it cannot double anything. Every other code — `aborted`,
// `failed-precondition`, `permission-denied` — means the server ANSWERED, and
// retrying those would be guessing at what it decided. This check exists mostly
// to hold that line.
//
// The second half is the banner. `navigator.onLine` is a reliable "no" and a
// worthless "yes": a till associated to a router with no internet reads as
// online, which is the commonest failure in a restaurant and the one moment the
// old banner was reassuring.
//
// Run: node tests/pos-offline.check.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'assets/js/pos-service.js'), 'utf8');
const TILL = fs.readFileSync(path.join(ROOT, 'assets/js/pos.js'), 'utf8');

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (actual, expected, label) => {
    if (actual === expected) ok(label);
    else fail(`${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

/** Lift `_posTxn` out of the module and drive it against a fake backend. */
function posTxn(runTransaction) {
    const start = SRC.indexOf('    async _posTxn(fn) {');
    if (start === -1) throw new Error('_posTxn not found in pos-service.js');
    const end = SRC.indexOf('\n    },\n', start);
    // eslint-disable-next-line no-new-func
    return new Function('runTransaction', `return ({ ${SRC.slice(start, end + 6)} });`)(runTransaction)._posTxn;
}

const err = (code) => Object.assign(new Error(code), { code });

(async () => {
    console.log('\npos offline\n');

    // ── 1. Every till transaction goes through the seam ─────────────────────
    // A write that bypasses it is a write that still fails on a blink, and the
    // one that would is whichever was added last.
    const bare = (SRC.match(/runTransaction\(this\.db,/g) || []).length;
    is(bare, 1, 'only `_posTxn` itself calls runTransaction directly');
    is((SRC.match(/await this\._posTxn\(|return this\._posTxn\(/g) || []).length >= 5, true,
        'every till transaction is routed through it');

    // ── 2. It rides out a blip ──────────────────────────────────────────────
    let calls = 0;
    const marks = [];
    const host = { db: {}, _posConnectionOk: (v) => marks.push(v) };

    let txn = posTxn(async () => {
        calls += 1;
        if (calls < 3) throw err('unavailable');
        return 'committed';
    });
    let t0 = Date.now();
    is(await txn.call(host, () => {}), 'committed', 'a write that fails twice still lands');
    is(calls, 3, '…on the third attempt');
    is(Date.now() - t0 >= 1300, true, '…having actually waited between tries, not spun');
    is(marks[marks.length - 1], true, 'a success reports the connection as reachable');

    // ── 3. It gives up, and says so ─────────────────────────────────────────
    calls = 0; marks.length = 0;
    txn = posTxn(async () => { calls += 1; throw err('unavailable'); });
    try {
        await txn.call(host, () => {});
        fail('an unreachable backend eventually reported success');
    } catch (e) {
        is(e.code, 'unavailable', 'a backend that never answers still fails the tap');
    }
    is(calls, 4, '…after a bounded number of tries, not forever');
    is(marks[marks.length - 1], false, '…and the banner is told');

    // ── 4. ⚠️ NOTHING ELSE IS RETRIED ───────────────────────────────────────
    // These mean the server ANSWERED. Retrying them would re-run a decision
    // somebody already made — and on `aborted`, which is a write conflict, it
    // would be re-running it against the very change that caused the conflict.
    for (const code of ['aborted', 'failed-precondition', 'permission-denied', 'invalid-argument']) {
        calls = 0;
        // eslint-disable-next-line no-loop-func
        txn = posTxn(async () => { calls += 1; throw err(code); });
        try {
            // eslint-disable-next-line no-await-in-loop
            await txn.call(host, () => {});
            fail(`${code} was swallowed`);
        } catch (e) {
            is(calls === 1 && e.code === code, true, `${code} is raised at once, never retried`);
        }
    }

    // A failure the server answered must not mark the connection down either —
    // a permission error is not a network problem and the banner would be lying.
    calls = 0; marks.length = 0;
    txn = posTxn(async () => { throw err('permission-denied'); });
    try { await txn.call(host, () => {}); } catch (_) { /* expected */ }
    is(marks.length, 0, 'a server-side refusal does not report the till offline');

    // ── 5. The banner does not trust `navigator.onLine` alone ───────────────
    is(/!navigator\.onLine \|\| !reachable/.test(TILL), true,
        'the banner shows when EITHER the interface is down or the backend is unreachable');
    is(/fluxy-pos-connection/.test(TILL) && /fluxy-pos-connection/.test(SRC), true,
        'the DAL reports what it observes and the till listens');
    // Coming back online must not clear the banner on its own: the interface
    // returning says nothing about the backend.
    const onlineHandler = TILL.slice(TILL.indexOf("window.addEventListener('online'"));
    is(/refresh\(/.test(onlineHandler.slice(0, 600)), true,
        'reconnecting proves itself with a real request before the banner clears');

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\npos offline: clean\n');
    process.exit(failures ? 1 : 0);
})();
