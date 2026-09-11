'use strict';

// =============================================================================
// FluxyOS — keeping the diner's functions warm (2026-09-11).
//
// WHY. A function instance that has sat idle (~15 min at a quiet outlet) or was
// just deployed starts cold: it loads firebase-admin, parses its credentials and
// opens a TLS connection to Firestore in Singapore from us-east-2. The load test
// measured what the first diner pays for that — a 4.1 s menu, a 5.1 s order,
// once a 12 s first photo (docs/perf/LOAD_2026-09-11.md). `qr-warm` (a scheduled
// function on the dashboard site) sends `GET …?warm=1` to each QR endpoint every
// few minutes, so the first diner finds an instance that is already up.
//
// WHAT A WARM-UP DOES: exactly the cold part — initialise the admin app and make
// ONE Firestore read (a document that does not exist), which opens the
// connection — and nothing else. No rate limiter (it would leave a counter
// document per ping in `rate_limits`, which has no TTL), no cache entries, no
// response a CDN may keep.
//
// Open to anyone, deliberately: the most it costs is one read of a missing
// document per request, less than a request with a well-formed bogus token, which
// already reaches the limiter and the directory.
// =============================================================================

// Not `__warmup__`: Firestore reserves ids of the form __x__ and refuses the
// read (INVALID_ARGUMENT) — caught by perf/qr-contract.js, not by a fake. A
// real token is 43 base64url characters, so this can never name a table.
const WARM_DOC = 'pos_table_directory/warmup-probe';

function isWarmup(event) {
    const q = (event && event.queryStringParameters) || {};
    return !!event && event.httpMethod === 'GET' && q.warm === '1';
}

/** `getDb` is a function so an initialisation failure is reported, not thrown. */
async function warmup(getDb, cors = {}) {
    const t0 = Date.now();
    try {
        await getDb().doc(WARM_DOC).get();
        return {
            statusCode: 204,
            headers: { ...cors, 'Cache-Control': 'no-store', 'Server-Timing': `warm;dur=${Date.now() - t0}` },
            body: ''
        };
    } catch (err) {
        console.error('[warmup] could not reach Firestore', err && err.message);
        return { statusCode: 503, headers: { ...cors, 'Cache-Control': 'no-store' }, body: '' };
    }
}

module.exports = { isWarmup, warmup, WARM_DOC };
