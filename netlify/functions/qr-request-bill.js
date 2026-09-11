'use strict';

const admin = require('firebase-admin');
const { allowOriginHeader } = require('./lib/allowed-origins');
const { consumeApprox, ipKey, clientIp, tooManyRequests } = require('./lib/rate-limit');
const { directoryEntry } = require('./lib/warm-cache');
const { isWarmup, warmup } = require('./lib/warmup');
// This table's orders — never the workspace's newest 50 (H1). See the header there.
const { tableOrders } = require('./lib/table-orders');

// =============================================================================
// FluxyOS — the diner says they are done and wants to pay.
//
//     POST /.netlify/functions/qr-request-bill   { token }
//
// THIS DOES NOT TAKE MONEY, and the distinction matters. A phone at a table
// cannot settle a bill; a cashier does, at the till. What this does is move
// every live order to `awaiting_payment` — the status that already exists for
// exactly this ("request bill is not payment",
// docs/CUSTOMER_ORDERING_PLAN_REVIEW.md §3) — so the till's board shows the
// table as ready to pay.
//
// ⚠️ EVERY LIVE ORDER, BECAUSE THE BILL IS THE TABLE'S, NOT THE LAST ROUND'S.
// Tickets split at the kitchen so a cook is never handed served dishes again,
// and the diner's status has nothing to do with what they owe: #001 eaten and
// #002 still frying are one meal to the person paying for them. Whether an
// order is on the bill is decided by paid-or-not, never by how far along it is.
//
// THE SITTING ENDS WHEN THE CASHIER SETTLES IT. Once an order is `paid`,
// `qr-order-status` stops returning it; when the last one goes the table reads
// clear and the next diner who scans starts fresh. Ordering again after payment
// means scanning again — the QR is the entry to a sitting.
//
// Idempotent, and partially so: a second tap moves whatever is left and reports
// the rest as already waiting. A diner who taps twice must not produce two
// states, and a round placed between the two taps must not be left behind.
// =============================================================================

const IP_BURST_LIMIT = 20;
const IP_BURST_SECONDS = 60;
const TOKEN_HOURLY_LIMIT = 60;
const HOUR_SECONDS = 60 * 60;

// The statuses a bill can be requested FROM. `paid` and `voided` are finished;
// `awaiting_payment` is already the answer.
const REQUESTABLE = ['open', 'submitted', 'sent', 'ready', 'served'];
const STALE_MS = 12 * 60 * 60 * 1000;

const SAFE = /^[A-Za-z0-9_-]{1,128}$/;

let _initialized = false;
function initAdmin() {
    if (!_initialized) {
        if (!admin.apps.length) {
            const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
            if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
            admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
        }
        _initialized = true;
    }
    return admin;
}

const msOf = (v) => {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (typeof v._seconds === 'number') return v._seconds * 1000;
    return null;
};

exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    const cors = {
        'Access-Control-Allow-Origin': allowOriginHeader(origin),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
    const json = (statusCode, body) => ({
        statusCode,
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    });

    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
    // Kept warm by the scheduled `qr-warm` — see lib/warmup.js. Before the method
    // check, so the POST endpoints can be warmed with a GET.
    if (isWarmup(event)) return warmup(() => initAdmin().firestore(), cors);
    if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_request' }); }
    const token = String(body.token || '');
    if (!SAFE.test(token)) return json(404, { error: 'not_found' });

    try {
        const db = initAdmin().firestore();

        // The limits and the token lookup together — one round trip instead of
        // five, each ~200 ms from us-east-2 (docs/perf/S1_BASELINE_2026-09-11.md,
        // F2). What keeps a bill correct is the transaction below, not the
        // limiter; see consumeApprox in lib/rate-limit.js.
        const [burst, perToken, dir] = await Promise.all([
            consumeApprox(db, {
                key: ipKey(clientIp(event.headers || {}), 'bill'),
                limit: IP_BURST_LIMIT, windowSeconds: IP_BURST_SECONDS
            }),
            consumeApprox(db, {
                key: `bill_${token}`, limit: TOKEN_HOURLY_LIMIT, windowSeconds: HOUR_SECONDS
            }),
            directoryEntry(db, token)
        ]);
        if (!burst.allowed) return tooManyRequests(burst, cors);
        if (!perToken.allowed) return tooManyRequests(perToken, cors);

        if (!dir || dir.revoked) return json(404, { error: 'not_found' });
        const workspaceId = dir.workspace_id;
        const tableId = dir.table_id;
        if (!workspaceId || !tableId) return json(404, { error: 'not_found' });

        // The same three exclusions qr-order-status applies — voided, paid,
        // and older than a service. What is left IS the active dining session.
        const recent = await tableOrders(db, workspaceId, tableId);
        // ⚠️ EVERY LIVE TICKET, NOT THE NEWEST ONE.
        //
        // Since tickets split at the kitchen (2026-09-06) a table can be
        // carrying several orders at once — #001 served, #002 still being
        // cooked. Asking for the bill is a statement about the TABLE, not about
        // whichever round happens to be last: the diner is done and wants one
        // total for everything they have eaten.
        //
        // This scanned only the first match for a day. The till's board would
        // then show #002 as ready to pay and #001 as merely `served`, so a
        // cashier settling the table settled the newest round and left the meal
        // that came before it open — a short payment that nothing reports,
        // because both documents are individually consistent.
        const now = Date.now();
        const live = [];
        recent.forEach((d) => {
            const o = d.data() || {};
            if (o.table_id !== tableId || o.voided_at) return;
            if (o.status === 'paid' || o.paid_at) return;
            const opened = msOf(o.opened_at) || msOf(o.created_at);
            if (opened && (now - opened) > STALE_MS) return;
            live.push(d);
        });

        if (!live.length) return json(409, { error: 'no_open_order' });

        const result = await db.runTransaction(async (tx) => {
            // Every read before any write — a transaction's contract, and the
            // reason this is a getAll rather than a get inside the loop.
            const snaps = await tx.getAll(...live.map((d) => d.ref));
            const moved = [];
            const already = [];
            snaps.forEach((snap, i) => {
                const o = snap.data() || {};
                // Re-checked inside the transaction: a cashier may have settled
                // one of these in the seconds since the read above.
                if (o.status === 'paid' || o.paid_at || o.voided_at) return;
                if (o.status === 'awaiting_payment') {
                    already.push(String(o.order_number || ''));
                    return;
                }
                if (!REQUESTABLE.includes(o.status)) return;

                tx.update(live[i].ref, {
                    status: 'awaiting_payment',
                    // The Orders board is a kitchen screen too, and "how long
                    // has this been waiting" is the question it exists to
                    // answer.
                    status_changed_at: admin.firestore.FieldValue.serverTimestamp(),
                    updated_at: admin.firestore.FieldValue.serverTimestamp(),
                    updated_by: 'qr'
                });
                moved.push(String(o.order_number || ''));
            });
            return { moved, already };
        });

        // Nothing moved and nothing was already waiting: every ticket closed
        // underneath the tap.
        if (!result.moved.length && !result.already.length) {
            return json(409, { error: 'order_closed' });
        }
        const numbers = [...result.moved, ...result.already].filter(Boolean);
        return json(200, {
            ok: true,
            // Idempotent: a second tap moves nothing and says so, rather than
            // producing a second state.
            already: result.moved.length === 0,
            order_count: result.moved.length + result.already.length,
            order_numbers: numbers,
            order_number: numbers[0] || null
        });
    } catch (err) {
        console.error('[qr-request-bill]', err && err.message);
        return json(500, { error: 'server_error' });
    }
};
