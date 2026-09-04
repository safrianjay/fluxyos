'use strict';

const admin = require('firebase-admin');
const { allowOriginHeader } = require('./lib/allowed-origins');
const { consume, ipKey, clientIp, tooManyRequests } = require('./lib/rate-limit');

// =============================================================================
// FluxyOS — what has been ordered at this table, and how far along it is.
//
//     GET /.netlify/functions/qr-order-status?token=<tableToken>
//
// WHY A SERVER READ AND NOT localStorage. The page could remember what it
// submitted, and that would be a lie the moment anything happened: a cashier
// voids a line, the kitchen marks the ticket ready, someone else at the table
// scans and adds a drink. The question a diner is actually asking — "is my food
// coming?" — can only be answered by the order document.
//
// IT RETURNS THE TABLE'S ORDER, NOT "THIS PHONE'S ORDERS". A QR order appends
// to the table's open order (there is no dining-session entity — see
// docs/CUSTOMER_ORDERING_PLAN_REVIEW.md §2.3), so the session IS the document,
// and four people at one table share it. That is the correct answer for a
// shared bill and it is the same information any of them would see on it.
//
// WHAT IS DELIBERATELY NOT RETURNED: cost, margin, the workspace id, the table
// id, payment instrument details, the cashier's identity, or anything about
// other tables. Just what was ordered, what it costs, and where it is.
// =============================================================================

const IP_BURST_LIMIT = 90;
const IP_BURST_SECONDS = 60;
const TOKEN_HOURLY_LIMIT = 600;
const HOUR_SECONDS = 60 * 60;

const SAFE = /^[A-Za-z0-9_-]{1,128}$/;

// The customer-facing meaning of each POS status. The till's ladder is
// open → submitted → sent → ready → served → awaiting_payment → paid, and a
// diner does not need the operational vocabulary — they need to know whether to
// keep waiting.
const STAGE = {
    open:              { step: 1, label: 'Menunggu konfirmasi' },
    submitted:         { step: 1, label: 'Menunggu konfirmasi' },
    sent:              { step: 2, label: 'Sedang disiapkan' },
    ready:             { step: 3, label: 'Siap diantar' },
    served:            { step: 4, label: 'Sudah diantar' },
    awaiting_payment:  { step: 5, label: 'Menunggu pembayaran' },
    paid:              { step: 6, label: 'Lunas' }
};

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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
    const json = (statusCode, body, cache) => ({
        statusCode,
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': cache || 'no-store' },
        body: JSON.stringify(body)
    });

    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
    if (event.httpMethod !== 'GET') return json(405, { error: 'method_not_allowed' });

    const token = String((event.queryStringParameters || {}).token || '');
    if (!SAFE.test(token)) return json(404, { error: 'not_found' });

    try {
        const db = initAdmin().firestore();

        const burst = await consume(db, {
            key: ipKey(clientIp(event.headers || {})),
            limit: IP_BURST_LIMIT, windowSeconds: IP_BURST_SECONDS
        });
        if (!burst.allowed) return tooManyRequests(burst, cors);
        const perToken = await consume(db, {
            key: `status_${token}`, limit: TOKEN_HOURLY_LIMIT, windowSeconds: HOUR_SECONDS
        });
        if (!perToken.allowed) return tooManyRequests(perToken, cors);

        const dirSnap = await db.doc(`pos_table_directory/${token}`).get();
        if (!dirSnap.exists) return json(404, { error: 'not_found' });
        const dir = dirSnap.data() || {};
        if (dir.revoked === true) return json(404, { error: 'not_found' });
        const workspaceId = dir.workspace_id;
        const tableId = dir.table_id;
        if (!workspaceId || !tableId) return json(404, { error: 'not_found' });

        // Same index-free shape `qr-order` and `getPosOrders` use: order by
        // created_at, filter in memory. There is no pos_orders composite index,
        // and a live order is recent by definition.
        const recent = await db.collection(`workspaces/${workspaceId}/pos_orders`)
            .orderBy('created_at', 'desc').limit(50).get();

        // A SITTING, not a table's whole history.
        //
        // This used to skip only voided orders, so a fresh scanner was shown the
        // PREVIOUS party's paid bill — measured across the live directory: 8 of
        // 9 tables, some 40-69 hours old, one for Rp51.281.667. Someone sits
        // down, scans, and is told they already owe fifty million rupiah.
        //
        // Three exclusions, each for its own reason:
        //   voided — a correction, not history; showing it only prompts "what
        //            happened?" at a table with nobody to answer
        //   paid   — the sitting is OVER. The bill was settled and the table
        //            cleared; it belongs to whoever was here before.
        //   stale  — an order left open for days is abandoned, not yours. A
        //            restaurant service does not span half a day, so anything
        //            older than that is a table nobody closed out.
        const STALE_MS = 12 * 60 * 60 * 1000;
        const now = Date.now();
        let doc = null;
        recent.forEach((d) => {
            if (doc) return;
            const o = d.data() || {};
            if (o.table_id !== tableId) return;
            if (o.voided_at) return;
            if (o.status === 'paid' || o.paid_at) return;
            const opened = msOf(o.opened_at) || msOf(o.created_at);
            if (opened && (now - opened) > STALE_MS) return;
            doc = d;
        });

        if (!doc) return json(200, { has_order: false, lines: [] });

        const o = doc.data() || {};
        const stage = STAGE[o.status] || { step: 1, label: 'Menunggu konfirmasi' };

        return json(200, {
            has_order: true,
            // The SITTING this table is currently in. The page holds it and
            // sends it back with each order, so a browser carrying yesterday's
            // session cannot silently continue into today's.
            order_id: doc.id,
            order_number: String(o.order_number || ''),
            status: o.status,
            stage: stage.step,
            stage_label: stage.label,
            // Line-level detail, because "is my food coming" is usually really
            // "did the extra shot make it onto the ticket".
            lines: (Array.isArray(o.lines) ? o.lines : []).map((l) => ({
                // The id, so the sheet can show the same photo the menu does.
                // No new exposure: the diner already received every visible
                // item id from `qr-menu` to be able to order at all.
                item_id: String(l.item_id || ''),
                item_name: String(l.item_name || '').slice(0, 120),
                quantity: Number(l.quantity) || 0,
                gross_amount: Number(l.gross_amount) || 0,
                note: l.note ? String(l.note).slice(0, 120) : null,
                modifiers: (Array.isArray(l.modifiers) ? l.modifiers : [])
                    .map((m) => String(m.option_name || '')).filter(Boolean)
            })),
            note: o.note ? String(o.note).slice(0, 200) : null,
            subtotal: Number(o.subtotal) || 0,
            service_charge_amount: Number(o.service_charge_amount) || 0,
            tax_amount: Number(o.tax_amount) || 0,
            discount_total: Number(o.discount_total) || 0,
            total_amount: Number(o.total_amount) || 0,
            paid_amount: Number(o.paid_amount) || 0,
            placed_at: msOf(o.opened_at),
            updated_at: msOf(o.status_changed_at) || msOf(o.updated_at)
        }, 'no-store');
    } catch (err) {
        console.error('[qr-order-status]', err && err.message);
        return json(404, { error: 'not_found' });
    }
};
