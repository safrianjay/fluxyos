'use strict';

const { allowOriginHeader } = require('./lib/allowed-origins');
const { consumeApprox, ipKey, clientIp, tooManyRequests } = require('./lib/rate-limit');
const { directoryEntry } = require('./lib/warm-cache');
const { isWarmup, warmup } = require('./lib/warmup');
// This table's orders — never the workspace's newest 50 (H1). See the header there.
const { tableOrders } = require('./lib/table-orders');
// ⚠️ THE SAME FILE THE TILL RUNS. `pos-pricing.js` is UMD precisely so this
// CommonJS function and the ES-module client can share it — a diner's phone
// and the cashier's screen pricing one outlet's bill differently is the
// failure this module exists to make impossible.
const pricing = require('../../assets/js/pos-pricing.js');

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

// A sitting does not outlive a service. Anything older is a table nobody closed
// out, not the party currently seated — the same window `qr-order-status` and
// `qr-request-bill` use, and it must stay the same in all three or a diner is
// shown a bill this endpoint would refuse to add to.
const STALE_MS = 12 * 60 * 60 * 1000;

const msOf = (v) => {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (typeof v._seconds === 'number') return v._seconds * 1000;
    return null;
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
    // Where the time went, per stage, on every answer — readable in the
    // browser's network panel and by perf/s1-baseline.js. This endpoint once
    // spent 4-7.6 s before a diner heard back and nothing said which part.
    const t0 = Date.now();
    const marks = [];
    let last = t0;
    const mark = (name) => { const now = Date.now(); marks.push(`${name};dur=${now - last}`); last = now; };
    const json = (statusCode, body) => ({
        statusCode,
        headers: {
            ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
            'Server-Timing': [...marks, `total;dur=${Date.now() - t0}`].join(', ')
        },
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

    const requested = Array.isArray(body.lines) ? body.lines.slice(0, MAX_LINES) : [];
    if (!requested.length) return json(400, { error: 'empty_order' });

    try {
        const db = initAdmin().firestore();

        // ── Idempotency ─────────────────────────────────────────────────────
        //
        // A phone on restaurant wifi retries. Without this, one tap of "Place
        // order" that times out on the way back becomes two kitchen tickets and
        // a double bill — and the customer, having seen no confirmation, is the
        // one who taps again. The ref lives in its OWN top-level collection
        // rather than on the order, because `pos_orders` has a `hasOnly` and an
        // extra key there would break every later till write (see the header).
        // Denied to all clients by the ruleset's final catch-all, Admin SDK only.
        //
        // ⚠️ READ HERE AND AGAIN INSIDE THE WRITE. The read below answers an
        // ordinary retry fast. It cannot answer a retry that arrives while the
        // first request is still writing — both would see no record and both
        // would write. So the record is also read and WRITTEN inside the order
        // transaction itself (below), where a second writer cannot slip past.
        const clientRef = SAFE.test(String(body.client_ref || '')) ? String(body.client_ref) : null;
        const idemRef = clientRef ? db.doc(`qr_order_refs/${token}_${clientRef}`) : null;
        const duplicateOf = (prior) => json(200, {
            ok: true, duplicate: true,
            order_id: prior.order_id, order_number: prior.order_number,
            total_amount: prior.total_amount
        });

        // ⚠️ ROUND TRIPS ARE THE COST (docs/perf/S1_BASELINE_2026-09-11.md,
        // F2): each Firestore call from us-east-2 is ~200 ms, and this endpoint
        // made fourteen of them one after another — 4 to 7.6 s for a diner to
        // hear their order was taken. Nothing in this first group depends on
        // anything else in it, so it is ONE round trip. `consumeApprox` rather
        // than a transaction: see its note in lib/rate-limit.js — the limiter
        // guards volume; the transaction below is what guards the order.
        const [burst, perToken, dir, seen] = await Promise.all([
            consumeApprox(db, {
                key: ipKey(clientIp(event.headers || {}), 'order'),
                limit: IP_BURST_LIMIT, windowSeconds: IP_BURST_SECONDS
            }),
            consumeApprox(db, {
                key: `order_${token}`, limit: TOKEN_HOURLY_LIMIT, windowSeconds: HOUR_SECONDS
            }),
            directoryEntry(db, token),
            idemRef ? idemRef.get() : Promise.resolve(null)
        ]);
        mark('limits');
        if (!burst.allowed) return tooManyRequests(burst, cors);
        if (!perToken.allowed) return tooManyRequests(perToken, cors);

        // `pos_table_directory` names the table (read via lib/warm-cache.js).
        if (!dir || dir.revoked === true) return json(404, { error: 'not_found' });
        const workspaceId = dir.workspace_id;
        const tableId = dir.table_id;
        if (!workspaceId || !tableId) return json(404, { error: 'not_found' });

        if (seen && seen.exists) return duplicateOf(seen.data() || {});

        // ── Resolve every price from the menu, never from the request ───────
        const ids = [...new Set(requested.map((l) => String((l && l.item_id) || '')).filter(Boolean))];
        if (!ids.length) return json(400, { error: 'empty_order' });

        // The second round trip: everything the decision needs, together — the
        // table, every requested item (prices come from HERE), the table's
        // recent orders, and the outlet's rates in case this opens a new
        // ticket. The rates are read speculatively from the outlet the
        // directory names; the table is checked against it below.
        const settingsFor = (dim) => db
            .doc(`workspaces/${workspaceId}/pos_outlet_settings/${dim}`).get()
            .catch((e) => {
                console.warn('[qr-order] outlet pricing unreadable; billing at zero rates', e);
                return null;
            });
        const [tableSnap, itemSnaps, recent, guessedSettings] = await Promise.all([
            db.doc(`workspaces/${workspaceId}/pos_tables/${tableId}`).get(),
            db.getAll(...ids.map((id) => db.doc(`workspaces/${workspaceId}/items/${id}`))),
            // Find the order already on this table: THIS TABLE's orders, not the
            // workspace's newest 50. A live order is not "recent" at a busy
            // outlet, and assuming it was is how tables vanished mid-meal (H1;
            // lib/table-orders.js).
            tableOrders(db, workspaceId, tableId),
            dir.dimension_id ? settingsFor(dir.dimension_id) : Promise.resolve(null)
        ]);
        mark('reads');

        if (!tableSnap.exists) return json(404, { error: 'not_found' });
        const table = tableSnap.data() || {};
        if (table.status === 'archived') return json(404, { error: 'not_found' });
        const dimensionId = table.dimension_id;
        if (!dimensionId) return json(409, { error: 'table_not_configured' });
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

        // ⚠️ THE KITCHEN IS THE BOUNDARY, and this is the whole rule.
        //
        // A round merges into the live order only while NOTHING HAS BEEN
        // PREPARED — `open` and `submitted` both mean the till has not sent it
        // yet, so four people still choosing produce one ticket rather than
        // four. Once the kitchen has the order (`sent` onward) a new round is a
        // NEW ORDER DOCUMENT, because a ticket is a unit of work: merging into
        // one puts already-served dishes back in front of a cook, who has no way
        // to tell which lines are new and will make them again.
        //
        // ⚠️ THIS WAS `['open','submitted','sent','ready','served']` FOR A DAY
        // (2026-09-05), and it also reset the order to `submitted` so the board
        // would notice the new lines. That reset is what made it dangerous:
        // the ENTIRE order went back to the kitchen, served items included.
        // Reverted 2026-09-06 on Jay's correction.
        //
        // Splitting the TICKET does not split the BILL — the customer's total is
        // consolidated across the session in `qr-order-status`, which is the
        // separation this model turns on: one bill, many tickets.
        const APPENDABLE = ['open', 'submitted'];
        // The kitchen has it: being cooked, ready, or on the table.
        const KITCHEN = ['sent', 'ready', 'served'];

        // What counts as part of the sitting happening at this table right now.
        // Three exclusions, the same three `qr-order-status` applies, so the
        // set this endpoint writes into is exactly the set the diner is shown.
        const nowMs = Date.now();
        const isLive = (o) => {
            if (!o || o.table_id !== tableId || o.voided_at) return false;
            // Paid is not finished — a settled ticket the kitchen still has
            // keeps the sitting alive, or a diner ordering dessert after paying
            // for their main would be told their sitting had ended.
            if (o.status === 'paid') return false;
            if (o.paid_at && ['served', 'awaiting_payment'].includes(o.status)) return false;
            const opened = msOf(o.opened_at) || msOf(o.created_at);
            return !(opened && (nowMs - opened) > STALE_MS);
        };

        // Newest first, because `recent` is. The OLDEST live ticket is the one
        // the sitting started with, and its rate card is the sitting's.
        const liveDocs = recent.docs.filter((d) => isLive(d.data() || {}));

        let openDoc = null;
        recent.forEach((d) => {
            if (openDoc) return;
            const o = d.data() || {};
            // `isLive` as well as APPENDABLE: an `open` order left over from
            // days ago is still technically appendable, and without this a new
            // party's first round would land on the previous one's abandoned
            // ticket and be billed with their food.
            if (isLive(o) && APPENDABLE.includes(o.status)) openDoc = d;
        });

        let orderId; let orderNumber; let totalAmount;

        // The idempotency record, written INSIDE whichever transaction writes
        // the order — so the order and the proof it exists land together, and
        // a racing retry reads one or the other, never neither.
        const idemRecord = (id, number, total) => ({
            order_id: id,
            order_number: number,
            total_amount: total,
            workspace_id: workspaceId,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
            // A retry arrives within seconds, not days. Read by the same
            // Firestore TTL policy `rate_limits` uses.
            expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000)
        });

        // TWO REFUSALS, and conflating them costs the diner an explanation.
        // `sitting_ended` means the table moved on and a new order is the right
        // answer — the page retries as one. `bill_requested` is the opposite:
        // the sitting is very much alive and a cashier is already on the way.
        //
        // ⚠️ A REQUESTED BILL CLOSES THE TABLE, whoever is asking and whatever
        // they hold. A cashier is walking over with a total; a ticket opened
        // behind it is the split bill this check exists to prevent, and it is
        // the one thing here that does NOT depend on the client's own sitting —
        // a second phone at the same table would otherwise slip past it.
        if (recent.docs.some((d) => {
            const o = d.data() || {};
            return isLive(o) && o.status === 'awaiting_payment';
        })) {
            return json(409, { error: 'bill_requested' });
        }

        // ⚠️ "THE KITCHEN HAS MY TICKET" IS NOT "MY SITTING IS OVER".
        //
        // This asked whether the client's sitting was the APPENDABLE order, so
        // from the moment a cook picked up round one, round two was refused
        // `sitting_ended` — and the page's retry re-sent it carrying NO sitting
        // at all. It worked, and that is what made it bad: the ordinary second
        // round went through the exact hole this guard was built to close, so
        // "the diner is continuing" and "a new party sat down" arrived as the
        // same request.
        //
        // The question is liveness, not appendability. A sitting that is still
        // live continues — into the open ticket if there is one, into a new
        // ticket of its own if the kitchen already has the last. `sitting_ended`
        // goes back to meaning what it says: that order is paid, voided, gone,
        // or belongs to another table.
        if (sitting) {
            const held = recent.docs.find((d) => d.id === sitting);
            if (!held || !isLive(held.data() || {})) {
                return json(409, { error: 'sitting_ended' });
            }
        }

        if (openDoc) {
            // ── APPEND to the sitting's order ───────────────────────────────
            const ref = openDoc.ref;
            const result = await db.runTransaction(async (tx) => {
                const [snap, prior] = idemRef ? await tx.getAll(ref, idemRef) : [await tx.get(ref), null];
                // A retry that raced the first request: it already landed.
                if (prior && prior.exists) return { duplicate: prior.data() || {} };
                const o = snap.data() || {};
                // It may have been sent to the kitchen, paid or voided between
                // the read above and here — a cook picking up the ticket, or a
                // cashier closing the bill, while a customer taps. Handed back
                // as it is NOW, so the decision below is made on the truth.
                if (!APPENDABLE.includes(o.status)) return { moved: o };

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
                // Re-priced from the ORDER's own snapshot, never from live
                // settings: a second round added to a bill opened an hour ago
                // must be taxed at the rate that bill was opened with, or the
                // receipt does not foot against its own lines.
                const priced = pricing.computeBillTotals({
                    subtotal, discountTotal, settings: o.pos_pricing || null
                });
                const service = priced.service;
                const tax = priced.tax;
                const total = priced.total;

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
                if (idemRef) tx.set(idemRef, idemRecord(ref.id, o.order_number, total));
                return { number: o.order_number, total };
            });

            mark('append');
            if (result.duplicate) return duplicateOf(result.duplicate);
            if (result.moved) {
                // ⚠️ THE KITCHEN TOOK THE TICKET WHILE THIS ROUND WAS IN FLIGHT
                // (docs/perf/LOAD_2026-09-11.md, F7). This refused `order_closed`,
                // and the page told a diner mid-meal "This table was just
                // settled" — false, and alarming. By the rule this whole file
                // turns on, a round the kitchen did not get in time is a NEW
                // TICKET in the same sitting: exactly what happens when the read
                // above already sees the ticket in the kitchen. So it falls
                // through to the branch below, inheriting the sitting's rates.
                // Only a sitting that is genuinely over — paid, voided, or
                // waiting on a bill — is refused, and by its real name.
                const nowDoc = result.moved;
                if (isLive(nowDoc) && nowDoc.status === 'awaiting_payment') {
                    return json(409, { error: 'bill_requested' });
                }
                if (!isLive(nowDoc) || !KITCHEN.includes(nowDoc.status)) {
                    return json(409, { error: 'order_closed' });
                }
            } else {
                orderId = ref.id;
                orderNumber = result.number;
                totalAmount = result.total;
            }
        }

        if (!orderId) {
            // ── OPEN a new order for the table ─────────────────────────────
            const dayKey = dayKeyFor(now, table.timezone);
            const counterRef = db.doc(
                `workspaces/${workspaceId}/counters/pos-${dimensionId}-${dayKey}`);
            const orderRef = db.collection(`workspaces/${workspaceId}/pos_orders`).doc();

            const subtotal = lines.reduce((s, l) => s + l.gross_amount, 0);

            // The outlet's rates AS THEY ARE NOW, frozen onto the order — the
            // same snapshot `createPosOrder` takes on the till, and the reason
            // `pos_pricing` exists. Best-effort: an outlet with no settings doc,
            // or a read that fails, prices at zero rates, which is what this
            // endpoint billed before settings existed. Refusing a diner's order
            // because a configuration document could not be read would be the
            // wrong trade at a table with food waiting.
            //
            // ⚠️ ONE SITTING, ONE RATE CARD. A second ticket INHERITS the rates
            // the first was opened with, exactly as an appended round does —
            // the tickets are separate for the kitchen, and the diner is still
            // paying one bill. Reading live settings here would let an owner
            // editing a rate mid-meal produce a table whose two tickets are
            // taxed differently, and the consolidated total would then carry a
            // single percentage that describes neither of them.
            let posPricing = null;
            const sittingRates = liveDocs.length
                ? (liveDocs[liveDocs.length - 1].data() || {}).pos_pricing || null
                : null;
            if (sittingRates) {
                posPricing = pricing.normalizeSettings(sittingRates);
            } else {
                // Already read, alongside the table — unless the table has moved
                // to another outlet since its card was printed, in which case
                // the TABLE's outlet is the one that charges.
                const cfg = dimensionId === dir.dimension_id ? guessedSettings : await settingsFor(dimensionId);
                if (cfg && cfg.exists) posPricing = pricing.normalizeSettings(cfg.data());
            }
            const newTotals = pricing.computeBillTotals({
                subtotal, discountTotal: 0, settings: posPricing
            });

            const opened = await db.runTransaction(async (tx) => {
                const [snap, prior] = idemRef ? await tx.getAll(counterRef, idemRef) : [await tx.get(counterRef), null];
                // A retry that raced the first request: it already landed.
                if (prior && prior.exists) return { duplicate: prior.data() || {} };
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
                    pos_pricing: posPricing,
                    service_charge_amount: newTotals.service,
                    tax_amount: newTotals.tax,
                    total_amount: newTotals.total,
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
                if (idemRef) tx.set(idemRef, idemRecord(orderRef.id, orderNumber, newTotals.total));
                return null;
            });
            mark('open');
            if (opened && opened.duplicate) return duplicateOf(opened.duplicate);

            orderId = orderRef.id;
            // The PRICED total, not the subtotal. This is what the diner's phone
            // is told they owe, and telling them the pre-tax figure while the
            // order document holds the taxed one is the same bug in miniature:
            // one number on the screen, a different one in the books.
            totalAmount = newTotals.total;
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
