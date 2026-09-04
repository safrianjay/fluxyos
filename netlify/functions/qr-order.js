'use strict';

const { allowOriginHeader } = require('./lib/allowed-origins');
const { consume, ipKey, clientIp, tooManyRequests } = require('./lib/rate-limit');

// =============================================================================
// FluxyOS — a customer at a table places an order. Public, unauthenticated.
//
//     POST /.netlify/functions/qr-order
//     { token, client_ref, customer_name?, customer_phone?, guest_count?,
//       lines: [{ item_id, quantity, note?, options: [optionId, ...] }] }
//
// THE CLIENT'S PRICES ARE NOT VALIDATED — THEY ARE IGNORED. The request carries
// item ids, quantities and option ids; every rupiah is read here from
// `items.sales_price` and `items.pos_modifier_groups[].price_delta`. Validating
// a submitted price would mean the browser's number is load-bearing whenever the
// comparison has a bug; not reading it at all means there is no bug to have.
// This is the same posture `addPosOrderLine` takes for the till.
//
// WHY THIS APPENDS TO THE TABLE'S OPEN ORDER. There is no dining-session entity
// (docs/CUSTOMER_ORDERING_PLAN_REVIEW.md §2.3) and V1 does not need one: today
// ONE open `pos_orders` document per table *is* the session — the floor plan
// derives occupancy from it and reservations hold the table around it. So a
// second scan appends lines to the order already on the table, and "add more
// items" works with no new schema, no new rules and no decision about which
// document the bill aggregates.
//
// ⚠️ THE DOCUMENT SHAPE IS LOAD-BEARING. `wsPosOrderKeys` in firestore.rules is
// a `hasOnly`, and the cashier's NEXT update sends the whole document back. An
// extra key written here — however sensible — is not refused now (Admin SDK
// bypasses rules) but makes every subsequent till write on that order fail with
// permission-denied. That is exactly how a day of till sales missed the ledger
// on 2026-08-31. The key list below must stay identical to `createPosOrder`.
// =============================================================================

const admin = require('firebase-admin');

// A person ordering food, not a script. These are generous for a real table
// splitting a large order and still stop enumeration.
const IP_BURST_LIMIT = 20;
const IP_BURST_SECONDS = 60;
const TOKEN_HOURLY_LIMIT = 120;
const HOUR_SECONDS = 60 * 60;

const MAX_LINES = 40;
const MAX_QTY = 99;

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

const str = (v, max) => {
    const s = String(v == null ? '' : v).trim().slice(0, max);
    return s || null;
};

/** The day key POS order numbers are sequenced by — local Jakarta day, as the till uses. */
function dayKeyFor(date, tz) {
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: tz || 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(date);
    } catch (_) {
        return date.toISOString().slice(0, 10);
    }
}

/**
 * Two lines are the same line when the item, the price, the note and the chosen
 * options all match — the same rule `_posLineKey` applies on the till, so a
 * kitchen ticket never reads "1 × Nasi Goreng" four times.
 */
function lineKey(itemId, price, note, mods) {
    return [itemId, price, note || '',
        mods.map((m) => `${m.option_id}:${m.price_delta}`).sort().join(',')].join('|');
}

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

    const requested = Array.isArray(body.lines) ? body.lines.slice(0, MAX_LINES) : [];
    if (!requested.length) return json(400, { error: 'empty_order' });

    try {
        const db = initAdmin().firestore();

        const burst = await consume(db, {
            key: ipKey(clientIp(event.headers || {})),
            limit: IP_BURST_LIMIT, windowSeconds: IP_BURST_SECONDS
        });
        if (!burst.allowed) return tooManyRequests(burst, cors);
        const perToken = await consume(db, {
            key: `order_${token}`, limit: TOKEN_HOURLY_LIMIT, windowSeconds: HOUR_SECONDS
        });
        if (!perToken.allowed) return tooManyRequests(perToken, cors);

        const dirSnap = await db.doc(`pos_table_directory/${token}`).get();
        if (!dirSnap.exists) return json(404, { error: 'not_found' });
        const dir = dirSnap.data() || {};
        if (dir.revoked === true) return json(404, { error: 'not_found' });
        const workspaceId = dir.workspace_id;
        const tableId = dir.table_id;
        if (!workspaceId || !tableId) return json(404, { error: 'not_found' });

        // ── Idempotency ─────────────────────────────────────────────────────
        //
        // A phone on restaurant wifi retries. Without this, one tap of "Place
        // order" that times out on the way back becomes two kitchen tickets and
        // a double bill — and the customer, having seen no confirmation, is the
        // one who taps again. The ref lives in its OWN top-level collection
        // rather than on the order, because `pos_orders` has a `hasOnly` and an
        // extra key there would break every later till write (see the header).
        // Denied to all clients by the ruleset's final catch-all, Admin SDK only.
        const clientRef = SAFE.test(String(body.client_ref || '')) ? String(body.client_ref) : null;
        const refDoc = clientRef ? db.doc(`qr_order_refs/${token}_${clientRef}`) : null;
        if (refDoc) {
            const seen = await refDoc.get();
            if (seen.exists) {
                const prior = seen.data() || {};
                return json(200, {
                    ok: true, duplicate: true,
                    order_id: prior.order_id, order_number: prior.order_number,
                    total_amount: prior.total_amount
                });
            }
        }

        const tableSnap = await db.doc(`workspaces/${workspaceId}/pos_tables/${tableId}`).get();
        if (!tableSnap.exists) return json(404, { error: 'not_found' });
        const table = tableSnap.data() || {};
        if (table.status === 'archived') return json(404, { error: 'not_found' });
        const dimensionId = table.dimension_id;
        if (!dimensionId) return json(409, { error: 'table_not_configured' });

        // ── Resolve every price from the menu, never from the request ───────
        const ids = [...new Set(requested.map((l) => String((l && l.item_id) || '')).filter(Boolean))];
        if (!ids.length) return json(400, { error: 'empty_order' });
        const itemSnaps = await db.getAll(
            ...ids.map((id) => db.doc(`workspaces/${workspaceId}/items/${id}`))
        );
        const menu = new Map();
        itemSnaps.forEach((s) => {
            if (!s.exists) return;
            const i = s.data() || {};
            // The same gate the menu endpoint applies. An item that is not on
            // the menu cannot be ordered by knowing its id.
            if (i.pos_visible !== true || i.status === 'archived') return;
            const price = Number(i.sales_price);
            if (!Number.isInteger(price) || price <= 0) return;
            menu.set(s.id, i);
        });

        const lines = [];
        for (const req of requested) {
            const item = menu.get(String((req && req.item_id) || ''));
            if (!item) continue;                       // silently dropped, reported below
            const qty = Math.floor(Number(req.quantity));
            if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY) continue;

            const price = Number(item.sales_price);
            const chosen = new Set((Array.isArray(req.options) ? req.options : [])
                .slice(0, 20).map((o) => String(o || '')));
            const mods = [];
            (Array.isArray(item.pos_modifier_groups) ? item.pos_modifier_groups : []).forEach((g) => {
                (Array.isArray(g.options) ? g.options : []).forEach((o) => {
                    if (!chosen.has(String(o.id || ''))) return;
                    mods.push({
                        group_id: String(g.id || ''),
                        group_name: str(g.name, 40),
                        option_id: String(o.id || ''),
                        option_name: str(o.name, 40),
                        price_delta: Math.round(Number(o.price_delta) || 0),
                        // SNAPSHOT of what this option consumes, copied on the
                        // way in exactly as the till does — the sale consumed
                        // what it consumed at the time, and editing the recipe
                        // next week must not rewrite Tuesday. Without it a
                        // priced QR modifier would move revenue and no stock.
                        consumes: (Array.isArray(o.consumes) ? o.consumes : []).slice(0, 5)
                            .map((c) => ({
                                item_id: String((c && c.item_id) || ''),
                                quantity: Math.round(Number(c && c.quantity) || 0)
                            }))
                            .filter((c) => c.item_id && c.quantity > 0)
                    });
                });
            });

            const modAmount = mods.reduce((s, m) => s + m.price_delta, 0);
            if (price + modAmount < 0) continue;
            const each = price + modAmount;
            const note = str(req.note, 120);

            const key = lineKey(String(req.item_id), price, note, mods);
            const at = lines.findIndex((l) => l._key === key);
            if (at >= 0) {
                lines[at].quantity += qty;
                lines[at].gross_amount = lines[at].quantity * each;
            } else {
                lines.push({
                    _key: key,
                    line_id: `q${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}${lines.length}`,
                    item_id: String(req.item_id),
                    item_name: str(item.name, 120) || 'Item',
                    quantity: qty,
                    unit_price: price,
                    gross_amount: qty * each,
                    modifiers: mods,
                    modifier_amount: modAmount,
                    discount_amount: 0,
                    discount_reason: null,
                    note
                });
            }
        }
        const rejected = requested.length - lines.length;
        lines.forEach((l) => { delete l._key; });
        if (!lines.length) return json(409, { error: 'nothing_orderable' });

        const now = new Date();
        // An order-level request from the diner ("sendok garpu 2"), distinct
        // from the per-line notes above.
        //
        // ⚠️ IT SHARES `pos_orders.note` WITH THE TILL'S PARK LABEL. That field
        // is written by `setPosOrderLabel` when a cashier holds an order, and
        // `docs/data-model/pos.md` already records the collision: "if an
        // order-level note is ever wanted for its own sake it collides with
        // this and one of the two needs a new field." A new field means
        // widening `wsPosOrderKeys` and a rules deploy.
        //
        // Taking the collision knowingly, because the blast radius is small and
        // one-directional: parking a QR order would overwrite the note AFTER
        // the kitchen has already read the ticket, and a customer request has
        // no downstream reader that a stale value could corrupt. Revisit if
        // parking QR orders ever becomes routine.
        // THE SITTING THE CLIENT BELIEVES IT IS IN.
        //
        // A page that has already ordered sends the order id it was given. If
        // the table has moved on since — the bill was settled and the table
        // cleared — that id no longer matches anything live, and the request is
        // refused rather than quietly opening a NEW sitting on a table the
        // customer has already paid for and left.
        //
        // ⚠️ WHAT THIS CANNOT DO, stated plainly: the printed QR is a static
        // URL, so "scanned the card just now" and "reopened a saved link" are
        // byte-identical requests. A client sending NO sitting is starting a
        // fresh one and must be allowed to — that is indistinguishable from the
        // next diner sitting down. What this closes is the SILENT path: a stale
        // tab continuing, or resuming, a sitting that is over.
        const sitting = SAFE.test(String(body.sitting || '')) ? String(body.sitting) : null;
        const orderNote = str(body.note, 200);
        const customerName = str(body.customer_name, 80);
        const customerPhone = str(body.customer_phone, 32);
        const guestRaw = Number(body.guest_count);
        const guestCount = Number.isInteger(guestRaw) && guestRaw > 0 ? Math.min(999, guestRaw) : null;

        // Find the order already on this table. Ordered and filtered in memory
        // rather than by a compound query, matching `getPosOrders` — there is no
        // pos_orders index in firestore.indexes.json and a live order is recent
        // by definition.
        const recent = await db.collection(`workspaces/${workspaceId}/pos_orders`)
            .orderBy('created_at', 'desc').limit(50).get();
        let openDoc = null;
        recent.forEach((d) => {
            if (openDoc) return;
            const o = d.data() || {};
            if (o.table_id === tableId && (o.status === 'open' || o.status === 'submitted')) openDoc = d;
        });

        let orderId; let orderNumber; let totalAmount;

        // The client claims to be mid-sitting. If the table is not in that
        // sitting any more, say so instead of starting a new one.
        if (sitting && (!openDoc || openDoc.id !== sitting)) {
            return json(409, { error: 'sitting_ended' });
        }

        if (openDoc) {
            // ── APPEND to the sitting's order ───────────────────────────────
            const ref = openDoc.ref;
            const result = await db.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                const o = snap.data() || {};
                // It may have been paid or voided between the read above and
                // here — a cashier closing the bill while a customer taps.
                if (o.status !== 'open' && o.status !== 'submitted') return null;

                const merged = [...(Array.isArray(o.lines) ? o.lines : [])];
                for (const add of lines) {
                    const key = lineKey(add.item_id, add.unit_price, add.note, add.modifiers);
                    const at = merged.findIndex((l) => lineKey(
                        l.item_id, Number(l.unit_price), l.note,
                        Array.isArray(l.modifiers) ? l.modifiers : []) === key);
                    if (at >= 0) {
                        const q = (Number(merged[at].quantity) || 0) + add.quantity;
                        const per = (Number(merged[at].unit_price) || 0) + (Number(merged[at].modifier_amount) || 0);
                        merged[at] = { ...merged[at], quantity: q, gross_amount: q * per };
                    } else {
                        merged.push(add);
                    }
                }

                const subtotal = merged.reduce((s, l) => s + (Number(l.gross_amount) || 0), 0);
                const lineDiscount = merged.reduce((s, l) => s + (Number(l.discount_amount) || 0), 0);
                const orderDiscount = Math.max(0, Number(o.discount_amount) || 0);
                const capped = Math.min(orderDiscount, Math.max(0, subtotal - lineDiscount));
                const discountTotal = lineDiscount + capped;
                const service = Math.max(0, Number(o.service_charge_amount) || 0);
                const tax = Math.max(0, Number(o.tax_amount) || 0);
                const total = subtotal - discountTotal + service + tax;

                // A targeted update, NOT a whole-document set. Only the derived
                // figures and the lines move; every other key keeps whatever the
                // till last wrote, so a stale read here can never revert a
                // cashier's discount or unset their shift.
                const patch = {
                    lines: merged,
                    subtotal,
                    discount_amount: capped,
                    discount_total: discountTotal,
                    service_charge_amount: service,
                    tax_amount: tax,
                    total_amount: total,
                    version: (Number(o.version) || 1) + 1,
                    updated_at: admin.firestore.FieldValue.serverTimestamp(),
                    updated_by: 'qr'
                };
                // A second round's note is APPENDED, not substituted. Someone
                // ordering more food does not retract the request they made
                // with the first round, and silently dropping it is worse than
                // a slightly long note.
                if (orderNote) {
                    const prior = typeof o.note === 'string' ? o.note.trim() : '';
                    patch.note = (prior && prior !== orderNote)
                        ? (prior + ' · ' + orderNote).slice(0, 200)
                        : orderNote;
                }
                // A customer who identified themselves fills in blanks; it never
                // overwrites what the cashier already recorded.
                if (customerName && !o.customer_name) patch.customer_name = customerName;
                if (customerPhone && !o.customer_phone) patch.customer_phone = customerPhone;
                if (guestCount && !o.guest_count) patch.guest_count = guestCount;

                tx.update(ref, patch);
                return { number: o.order_number, total };
            });

            if (!result) return json(409, { error: 'order_closed' });
            orderId = ref.id;
            orderNumber = result.number;
            totalAmount = result.total;
        } else {
            // ── OPEN a new order for the table ─────────────────────────────
            const dayKey = dayKeyFor(now, table.timezone);
            const counterRef = db.doc(
                `workspaces/${workspaceId}/counters/pos-${dimensionId}-${dayKey}`);
            const orderRef = db.collection(`workspaces/${workspaceId}/pos_orders`).doc();

            const subtotal = lines.reduce((s, l) => s + l.gross_amount, 0);

            await db.runTransaction(async (tx) => {
                const snap = await tx.get(counterRef);
                const next = (snap.exists ? (Number(snap.data().seq) || 0) : 0) + 1;
                tx.set(counterRef, {
                    seq: next,
                    entity_id: workspaceId,
                    updated_at: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                orderNumber = `${dayKey}-${String(next).padStart(3, '0')}`;

                // EVERY KEY IN `wsPosOrderKeys`, AND NOTHING ELSE. See the header.
                tx.set(orderRef, {
                    order_number: orderNumber,
                    dimension_id: dimensionId,
                    table_id: tableId,
                    table_label: str(table.label, 40),
                    channel: 'qr',
                    // Not 'open'. A QR order arrives needing acknowledgement —
                    // the till already counts and toasts `newQrOrders` on this.
                    status: 'submitted',
                    lines,
                    subtotal,
                    discount_amount: 0,
                    discount_reason: null,
                    discount_total: 0,
                    service_charge_amount: 0,
                    tax_amount: 0,
                    total_amount: subtotal,
                    payments: [],
                    paid_amount: 0,
                    note: orderNote,
                    customer_name: customerName,
                    customer_phone: customerPhone,
                    guest_count: guestCount,
                    // No drawer rang this up — nobody was at a till. Null is the
                    // honest answer and the POS overview already nudges about
                    // sales that sit outside a shift.
                    shift_id: null,
                    version: 1,
                    opened_at: admin.firestore.Timestamp.fromDate(now),
                    status_changed_at: admin.firestore.Timestamp.fromDate(now),
                    paid_at: null,
                    voided_at: null,
                    void_reason: null,
                    transaction_id: null,
                    stock_adjustment_id: null,
                    refund_transaction_id: null,
                    refund_reason: null,
                    refunded_at: null,
                    created_at: admin.firestore.FieldValue.serverTimestamp(),
                    updated_at: admin.firestore.FieldValue.serverTimestamp(),
                    created_by: 'qr',
                    updated_by: 'qr'
                });
            });

            orderId = orderRef.id;
            totalAmount = subtotal;
        }

        if (refDoc) {
            await refDoc.set({
                order_id: orderId,
                order_number: orderNumber,
                total_amount: totalAmount,
                workspace_id: workspaceId,
                created_at: admin.firestore.FieldValue.serverTimestamp(),
                // A retry arrives within seconds, not days. Read by the same
                // Firestore TTL policy `rate_limits` uses.
                expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000)
            });
        }

        return json(200, {
            ok: true,
            // The page stores this and sends it back as `sitting`.
            order_id: orderId,
            order_number: orderNumber,
            total_amount: totalAmount,
            // Said plainly rather than hidden: an item that went out of stock or
            // off the menu between loading it and ordering it is dropped, and the
            // page tells the customer which so the total is never a surprise.
            rejected_lines: rejected > 0 ? rejected : 0
        });
    } catch (err) {
        console.error('[qr-order]', err && err.message);
        return json(500, { error: 'server_error' });
    }
};
