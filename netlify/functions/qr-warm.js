'use strict';

// =============================================================================
// FluxyOS — keep the QR diner functions warm (scheduled, dashboard site only).
//
// Every 5 minutes during trading hours this sends `GET …?warm=1` to each of the
// five functions a diner's phone calls, on the ORDER site, so an idle outlet's
// first diner does not pay a cold start: 4.1 s for a menu, 5.1 s for an order,
// once 12 s for a first photo (docs/perf/LOAD_2026-09-11.md). What a warm-up
// does, and why it is safe to leave open, is in lib/warmup.js.
//
// ⚠️ ONE INSTANCE PER FUNCTION. A ping keeps one instance of each function
// ready; a burst of diners still starts more. It removes the "first diner at a
// quiet restaurant" cold start, which is the one everybody at a quiet
// restaurant meets.
//
// WHEN: `*/5 22,23,0-15 * * *` UTC = 05:00–22:59 WIB, 06:00–23:59 SGT/MYT/PHT.
// Outside those hours nobody is ordering.
//
// ⚠️ MEASURED 2026-09-11: an instance stays warm 2.5–4 minutes after its last
// request (a function hit 1 and 2.5 min after a ping read in ~260 ms; at 4 min
// it was cold again, 1,392 ms). So at a 5-minute cadence the ping itself always
// meets a cold instance (every heartbeat shows ~1,370 ms) and pays the start-up
// FOR the next diner: one who arrives within ~2.5 min of a ping is warm, one
// after ~4 min is not — roughly half to three-quarters of first diners.
// Covering all of them needs every 2 minutes (~97k invocations a month),
// which the Free plan's 125k, shared by every function on the team, cannot
// carry. The real fix is where the functions run (docs/perf/LOAD_2026-09-11.md).
// COST at this cadence: 216 runs a day here + 1,080 warm invocations a day on
// the order site ≈ 39k a month, 5 reads of a missing document and 1 heartbeat
// write per run.
//
// ON BY DEFAULT, unlike the sweeps beside it, whose default-off flags exist
// because they email people or change data. This does neither. Opt out with
// QR_WARM_DISABLED=true on the dashboard site.
//
// PROOF IT RUNS: each run writes `ops_heartbeats/qr-warm` (Admin SDK only — the
// ruleset's catch-all denies every client). A cron that never registered is
// otherwise invisible: see the note on `ledger-integrity-sweep` in netlify.toml.
//
// ⚠️ The schedule must match netlify.toml `[functions."qr-warm"]`, and this file
// must stay in SCHEDULED_FUNCTIONS (scripts/prepare-deploy.js) so it runs from
// the dashboard site only — on all four it would ping four times over.
// =============================================================================

const { schedule } = require('@netlify/functions');
const admin = require('firebase-admin');

const CRON = '*/5 22,23,0-15 * * *';
const ORIGIN = process.env.ORDER_BASE_URL || 'https://order.fluxyos.com';
const FUNCTIONS = ['qr-menu', 'qr-menu-image', 'qr-order', 'qr-order-status', 'qr-request-bill'];

function db() {
    if (!admin.apps.length) {
        const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
        if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
        admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
    }
    return admin.firestore();
}

async function warmAll() {
    const results = {};
    await Promise.all(FUNCTIONS.map(async (fn) => {
        const t0 = Date.now();
        try {
            const r = await fetch(`${ORIGIN}/.netlify/functions/${fn}?warm=1`, {
                headers: { 'User-Agent': 'FluxyOS-warm/1' }
            });
            results[fn] = { status: r.status, ms: Date.now() - t0, server: r.headers.get('server-timing') || null };
        } catch (err) {
            results[fn] = { status: 0, ms: Date.now() - t0, error: String((err && err.message) || err).slice(0, 120) };
        }
    }));
    return results;
}

exports.handler = schedule(CRON, async () => {
    if (process.env.QR_WARM_DISABLED === 'true') {
        console.log('qr-warm: disabled (QR_WARM_DISABLED=true)');
        return { statusCode: 200, body: 'disabled' };
    }
    const results = await warmAll();
    const cold = Object.entries(results).filter(([, r]) => r.status !== 204).map(([fn]) => fn);
    console.log(`qr-warm: ${JSON.stringify(results)}${cold.length ? ` · NOT WARMED: ${cold.join(', ')}` : ''}`);
    try {
        await db().doc('ops_heartbeats/qr-warm').set({
            at: admin.firestore.FieldValue.serverTimestamp(),
            origin: ORIGIN,
            results,
            all_warm: cold.length === 0
        });
    } catch (err) {
        console.warn('qr-warm: heartbeat not written', err && err.message);
    }
    return { statusCode: 200, body: JSON.stringify(results) };
});

// For perf/qr-contract.js and a manual check — not a route.
exports._warmAll = warmAll;
exports._CRON = CRON;
