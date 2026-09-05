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

// Only the fields the sheet renders. The order document carries payments,
// shift ids and journal stamps, none of which is a diner's business.
function pricingOf(o) {
    const p = (o && o.pos_pricing) || null;
    if (!p) return null;
    return {
        tax_label: typeof p.tax_label === 'string' ? p.tax_label.slice(0, 24) : 'Pajak',
        tax_rate_percent: Number(p.tax_rate_percent) || 0,
        tax_inclusive: p.tax_inclusive === true,
        service_rate_percent: Number(p.service_rate_percent) || 0
    };
}

function lineOf(l) {
    return {
        item_id: String(l.item_id || ''),
        item_name: String(l.item_name || '').slice(0, 120),
        quantity: Number(l.quantity) || 0,
        gross_amount: Number(l.gross_amount) || 0,
        note: l.note ? String(l.note).slice(0, 120) : null,
        modifiers: (Array.isArray(l.modifiers) ? l.modifiers : [])
            .map((m) => String(m.option_name || '')).filter(Boolean)
    };
}

/**
 * Earlier orders this DEVICE placed at this table.
 *
 * ⚠️ EVERY ID IS RE-CHECKED AGAINST THE TABLE. The list arrives from the
 * client, so it is a request, not a fact — an id belonging to another table is
 * dropped rather than answered. That check is the entire security of this, and
 * it is why the ids are read one at a time instead of trusted in bulk.
 *
 * Capped: a hero's worth of history is what a diner wants, not an audit trail.
 */
const HISTORY_MAX = 10;

async function historyFor(db, workspaceId, tableId, raw, currentId) {
    const ids = String(raw || '')
        .split(',')
        .map((v) => v.trim())
        .filter((v) => SAFE.test(v) && v !== currentId)
        .slice(-HISTORY_MAX);
    if (!ids.length) return [];

    const snaps = await db.getAll(
        ...ids.map((id) => db.doc(`workspaces/${workspaceId}/pos_orders/${id}`)));
    return snaps
        .map((snap) => {
            if (!snap.exists) return null;
            const o = snap.data() || {};
            // The check that makes this safe.
            if (o.table_id !== tableId) return null;
            // A voided order is a correction, not history — showing it only
            // prompts "what happened?" at a table with nobody to answer.
            if (o.voided_at) return null;
            return {
                order_id: snap.id,
                order_number: String(o.order_number || ''),
                status: o.status,
                lines: (Array.isArray(o.lines) ? o.lines : []).map(lineOf),
                subtotal: Number(o.subtotal) || 0,
                discount_total: Number(o.discount_total) || 0,
                service_charge_amount: Number(o.service_charge_amount) || 0,
                tax_amount: Number(o.tax_amount) || 0,
                total_amount: Number(o.total_amount) || 0,
                pricing: pricingOf(o),
                placed_at: msOf(o.opened_at) || msOf(o.created_at)
            };
        })
        .filter(Boolean)
        .sort((a, b) => (b.placed_at || 0) - (a.placed_at || 0));
}

/**
 * The bill: every live order at this table, summed.
 *
 * ⚠️ TICKETS SPLIT, BILLS DO NOT. The kitchen gets a separate order per round
 * so a cook is never handed already-served dishes again; the customer gets one
 * total, because from their seat it is one meal. That separation is the whole
 * model — splitting the ticket must never split what they owe.
 *
 * `paid_amount` is summed too, so a part-settled table shows what is genuinely
 * left rather than the gross.
 */
function sessionOf(docs) {
    const add = (k) => docs.reduce((t, d) => t + (Number((d.data() || {})[k]) || 0), 0);
    const total = add('total_amount');
    const paid = add('paid_amount');
    return {
        order_count: docs.length,
        subtotal: add('subtotal'),
        discount_total: add('discount_total'),
        service_charge_amount: add('service_charge_amount'),
        tax_amount: add('tax_amount'),
        total_amount: total,
        paid_amount: paid,
        outstanding: Math.max(0, total - paid)
    };
}

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

    const q = event.queryStringParameters || {};
    const token = String(q.token || '');
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

        // ⚠️ EVERY LIVE ORDER, NOT THE FIRST ONE. Since 2026-09-06 a round
        // placed after the kitchen has the previous ticket becomes its own
        // ORDER — the kitchen needs separate tickets or a cook re-makes already
        // served dishes. The customer's BILL is not split by that: it is the sum
        // of everything still owed at this table.
        //
        // The active dining session is DERIVED, not stored: it is exactly the
        // set of orders here that are neither paid, voided, nor stale. Paying
        // one drops it out; paying all of them ends the session and the next
        // party starts clean. Same call `pos_tables` makes about occupancy
        // (pos.md §2) — a stored session and the real orders eventually
        // disagree, and nothing would report it.
        const live = [];
        recent.forEach((d) => {
            const o = d.data() || {};
            if (o.table_id !== tableId) return;
            if (o.voided_at) return;
            if (o.status === 'paid' || o.paid_at) return;
            const opened = msOf(o.opened_at) || msOf(o.created_at);
            if (opened && (now - opened) > STALE_MS) return;
            live.push(d);
        });
        // Newest first — the one a diner is asking about is the one they just
        // placed, and it is what the hero and the progress track describe.
        const doc = live[0] || null;

        // ── The diner's OWN history ─────────────────────────────────────
        //
        // The scan above deliberately skips paid orders: from the table's point
        // of view that sitting is over and the bill belongs to whoever was here
        // before. But the DEVICE knows which orders it placed, and after paying
        // and reordering a diner still wants to see what they had — to check it,
        // or to order it again.
        //
        // So the page sends the ids IT holds, and each is returned only if it
        // belongs to THIS table. A guessed id from another table resolves to
        // nothing, and nobody ever sees a bill they did not place.
        const history = await historyFor(db, workspaceId, tableId, q.ids, doc && doc.id);

        if (!doc) {
            return json(200, {
                has_order: false, lines: [], history,
                orders: [], session: sessionOf([])
            }, 'no-store');
        }

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
            // The item id rides along so the sheet can show the same photo the
            // menu does. No new exposure: the diner already received every
            // visible item id from `qr-menu` to be able to order at all.
            lines: (Array.isArray(o.lines) ? o.lines : []).map(lineOf),
            note: o.note ? String(o.note).slice(0, 200) : null,
            subtotal: Number(o.subtotal) || 0,
            service_charge_amount: Number(o.service_charge_amount) || 0,
            tax_amount: Number(o.tax_amount) || 0,
            // The rates THIS bill was charged at, not whatever is configured
            // now. Snapshotted onto the order at creation precisely so a
            // receipt stays reproducible after an owner edits a rate.
            pricing: pricingOf(o),
            discount_total: Number(o.discount_total) || 0,
            total_amount: Number(o.total_amount) || 0,
            paid_amount: Number(o.paid_amount) || 0,
            placed_at: msOf(o.opened_at),
            updated_at: msOf(o.status_changed_at) || msOf(o.updated_at),
            history,
            // Every live ticket, each keeping its OWN status — that is what the
            // kitchen works from and what the diner watches per round.
            orders: live.map((d) => {
                const x = d.data() || {};
                const st = STAGE[x.status] || { step: 1, label: 'Menunggu konfirmasi' };
                return {
                    order_id: d.id,
                    order_number: String(x.order_number || ''),
                    status: x.status,
                    stage: st.step,
                    stage_label: st.label,
                    lines: (Array.isArray(x.lines) ? x.lines : []).map(lineOf),
                    subtotal: Number(x.subtotal) || 0,
                    discount_total: Number(x.discount_total) || 0,
                    service_charge_amount: Number(x.service_charge_amount) || 0,
                    tax_amount: Number(x.tax_amount) || 0,
                    total_amount: Number(x.total_amount) || 0,
                    paid_amount: Number(x.paid_amount) || 0,
                    pricing: pricingOf(x),
                    placed_at: msOf(x.opened_at) || msOf(x.created_at)
                };
            }),
            // …and ONE bill across all of them.
            session: sessionOf(live)
        }, 'no-store');
    } catch (err) {
        console.error('[qr-order-status]', err && err.message);
        return json(404, { error: 'not_found' });
    }
};
