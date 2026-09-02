'use strict';

// =============================================================================
// The rate limiter counts, refuses, and fails OPEN.
//
// `POS_IMPLEMENTATION_PLAN.md` §18.10 calls per-token, per-IP and per-workspace
// caps a Phase 2 blocker. This is the primitive those caps are built from, so
// its arithmetic is worth asserting rather than assuming: an off-by-one in a
// limiter is either a public endpoint with no ceiling, or a restaurant whose
// customers are refused their own menu.
//
// Runs against a FAKE Firestore rather than the emulator. What is under test is
// the window arithmetic and the failure posture, not Firestore's transaction
// semantics — and a fake makes the "the database is down" case, which is the
// one with the most surprising correct answer, actually reachable.
//
// Run: node tests/rate-limit.check.js
// =============================================================================

const path = require('path');

const { consume, ipKey, clientIp, tooManyRequests } =
    require(path.join(__dirname, '..', 'netlify/functions/lib/rate-limit.js'));

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (actual, expected, label) => {
    if (actual === expected) ok(label);
    else fail(`${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

// A Firestore stand-in: documents in a Map, and a transaction that just runs the
// callback. Enough for counting; it is not pretending to be concurrent.
function fakeDb({ throwOnTransaction = false } = {}) {
    const docs = new Map();
    const db = {
        _docs: docs,
        collection: () => ({ doc: (id) => ({ id }) }),
        runTransaction: async (fn) => {
            if (throwOnTransaction) throw new Error('emulated Firestore outage');
            return fn({
                get: async (ref) => ({
                    exists: docs.has(ref.id),
                    data: () => docs.get(ref.id)
                }),
                set: (ref, value) => { docs.set(ref.id, { ...(docs.get(ref.id) || {}), ...value }); }
            });
        }
    };
    return db;
}

(async () => {
    console.log('\nrate limit\n');

    // ── It counts, and the limit is inclusive of the last allowed request ────
    const db = fakeDb();
    const opts = { key: 'tok_abc', limit: 3, windowSeconds: 60 };
    const r1 = await consume(db, opts);
    const r2 = await consume(db, opts);
    const r3 = await consume(db, opts);
    const r4 = await consume(db, opts);

    is(r1.allowed, true, 'the first request is allowed');
    is(r1.count, 1, '…and counts as one');
    is(r3.allowed, true, 'the third request, at the limit, is still allowed');
    is(r3.count, 3, '…and is the third');
    is(r4.allowed, false, 'the fourth is refused — a limit of 3 means 3, not 4');
    is(r4.count, 3, 'a refused request does not increment the counter');

    // A refusal must say when to come back, or a client can only retry blindly.
    is(r4.retryAfter > 0 && r4.retryAfter <= 60, true,
        `retryAfter is inside the window (got ${r4.retryAfter})`);

    // ── Keys are independent ────────────────────────────────────────────────
    const other = await consume(db, { key: 'tok_different', limit: 3, windowSeconds: 60 });
    is(other.allowed, true, 'a different key has its own budget');
    is(other.count, 1, '…starting from zero');

    // ── A new window is a new document, so nothing has to be reset ──────────
    // The window start is in the document id. Proven by counting the documents:
    // one key across two windows is two documents, never one that was rewound.
    const ids = [...db._docs.keys()].filter((k) => k.startsWith('tok_abc'));
    is(ids.length, 1, 'one key in one window is one document');
    is(/__\d+$/.test(ids[0]), true, 'the window start is part of the document id');

    // A one-second window, waited out, must produce a different document.
    const shortOpts = { key: 'tok_roll', limit: 1, windowSeconds: 1 };
    await consume(db, shortOpts);
    const blocked = await consume(db, shortOpts);
    is(blocked.allowed, false, 'a limit of 1 refuses the second request in the window');
    await new Promise((r) => setTimeout(r, 1100));
    const nextWindow = await consume(db, shortOpts);
    is(nextWindow.allowed, true, 'the next window starts fresh');
    is([...db._docs.keys()].filter((k) => k.startsWith('tok_roll')).length, 2,
        'which is a second document, not a rewound one');

    // ── FAILING OPEN is the deliberate choice ───────────────────────────────
    // This protects against cost and noise, not against a breach. A limiter that
    // failed closed would turn a database blip into a restaurant whose customers
    // cannot see the menu — worse than a minute of unthrottled reads.
    const broken = await consume(fakeDb({ throwOnTransaction: true }),
        { key: 'tok_x', limit: 1, windowSeconds: 60 });
    is(broken.allowed, true, 'an unreachable Firestore ALLOWS the request');
    is(broken.degraded, true, '…and says so, so it is visible rather than assumed');

    // ── The IP key is hashed, never the address ─────────────────────────────
    const k = ipKey('203.0.113.7');
    is(k.startsWith('ip_'), true, 'the IP key is namespaced');
    is(k.includes('203.0.113.7'), false, 'the address itself is never the key');
    is(ipKey('203.0.113.7') === k, true, 'the same address hashes the same way');
    is(ipKey('203.0.113.8') === k, false, 'a different address hashes differently');

    // ── Only the FIRST x-forwarded-for entry is the client ──────────────────
    // The rest are proxy hops. Keying on the whole chain would let a caller add
    // a header and get a fresh budget on every request.
    is(clientIp({ 'x-nf-client-connection-ip': '198.51.100.4' }), '198.51.100.4',
        'Netlify\'s own header wins');
    is(clientIp({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1, 10.0.0.2' }), '198.51.100.9',
        'the first forwarded-for entry is the client');
    is(clientIp({}), 'unknown', 'no header at all is a key, not a crash');

    // ── The refusal shape ───────────────────────────────────────────────────
    const res = tooManyRequests(r4, { 'X-Test': '1' });
    is(res.statusCode, 429, 'a refusal is 429');
    is(res.headers['Retry-After'], String(r4.retryAfter), 'it carries Retry-After');
    is(res.headers['Cache-Control'], 'no-store', 'and is never cached');
    is(res.headers['X-Test'], '1', 'the caller\'s headers survive (CORS must)');

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nrate limit: clean\n');
    process.exit(failures ? 1 : 0);
})().catch((err) => {
    console.error('\n✗ rate-limit check threw:', err);
    process.exit(1);
});
