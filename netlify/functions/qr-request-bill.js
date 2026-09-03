'use strict';

const admin = require('firebase-admin');
const { allowOriginHeader } = require('./lib/allowed-origins');
const { consume, ipKey, clientIp, tooManyRequests } = require('./lib/rate-limit');

// =============================================================================
// FluxyOS — the diner says they are done and wants to pay.
//
//     POST /.netlify/functions/qr-request-bill   { token }
//
// THIS DOES NOT TAKE MONEY, and the distinction matters. A phone at a table
// cannot settle a bill; a cashier does, at the till. What this does is move the
// order to `awaiting_payment` — the status that already exists for exactly this
// ("request bill is not payment", docs/CUSTOMER_ORDERING_PLAN_REVIEW.md §3) —
// so the till's board shows the table as ready to pay.
//
// THE SITTING ENDS WHEN THE CASHIER SETTLES IT. Once the order is `paid`,
// `qr-order-status` stops returning it, so the table reads clear and the next
// diner who scans starts fresh. Ordering again after payment means scanning
// again, which is the intended shape: the QR is the entry to a sitting.
//
// Idempotent. A second tap on a bill already requested is a no-op that returns
// the same answer — a diner who taps twice must not produce two states.
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
    if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_request' }); }
    const token = String(body.token || '');
    if (!SAFE.test(token)) return json(404, { error: 'not_found' });

    try {
        const db = initAdmin().firestore();

        const burst = await consume(db, {
            key: ipKey(clientIp(event.headers || {})),
            limit: IP_BURST_LIMIT, windowSeconds: IP_BURST_SECONDS
        });
        if (!burst.allowed) return tooManyRequests(burst, cors);
        const perToken = await consume(db, {
            key: `bill_${token}`, limit: TOKEN_HOURLY_LIMIT, windowSeconds: HOUR_SECONDS
        });
        if (!perToken.allowed) return tooManyRequests(perToken, cors);

        const dirSnap = await db.doc(`pos_table_directory/${token}`).get();
        if (!dirSnap.exists) return json(404, { error: 'not_found' });
        const dir = dirSnap.data() || {};
        if (dir.revoked === true) return json(404, { error: 'not_found' });
        const workspaceId = dir.workspace_id;
        const tableId = dir.table_id;
        if (!workspaceId || !tableId) return json(404, { error: 'not_found' });

        // The same "which order is this sitting" rule qr-order-status applies.
        const recent = await db.collection(`workspaces/${workspaceId}/pos_orders`)
            .orderBy('created_at', 'desc').limit(50).get();
        const now = Date.now();
        let doc = null;
        recent.forEach((d) => {
            if (doc) return;
            const o = d.data() || {};
            if (o.table_id !== tableId || o.voided_at) return;
            if (o.status === 'paid' || o.paid_at) return;
            const opened = msOf(o.opened_at) || msOf(o.created_at);
            if (opened && (now - opened) > STALE_MS) return;
            doc = d;
        });

        if (!doc) return json(409, { error: 'no_open_order' });

        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(doc.ref);
            const o = snap.data() || {};
            // Re-checked inside the transaction: a cashier may have settled the
            // bill in the seconds between the read above and this write.
            if (o.status === 'paid' || o.paid_at || o.voided_at) return { closed: true };
            if (o.status === 'awaiting_payment') return { already: true, order_number: o.order_number };
            if (!REQUESTABLE.includes(o.status)) return { closed: true };

            tx.update(doc.ref, {
                status: 'awaiting_payment',
                // The Orders board is a kitchen screen too, and "how long has
                // this been waiting" is the question it exists to answer.
                status_changed_at: admin.firestore.FieldValue.serverTimestamp(),
                updated_at: admin.firestore.FieldValue.serverTimestamp(),
                updated_by: 'qr'
            });
            return { ok: true, order_number: o.order_number };
        });

        if (result.closed) return json(409, { error: 'order_closed' });
        return json(200, {
            ok: true,
            already: !!result.already,
            order_number: result.order_number || null
        });
    } catch (err) {
        console.error('[qr-request-bill]', err && err.message);
        return json(500, { error: 'server_error' });
    }
};
