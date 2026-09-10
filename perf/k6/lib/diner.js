// =============================================================================
// perf/k6/lib/diner.js — what one phone at a table sends, request for request.
//
// Mirrors order.html rather than an idealised client, because the point is the
// load real diners create:
//   - load     → qr-menu, then qr-order-status (the page reconciles its sitting
//                on every fresh load)
//   - browse   → qr-menu-image per photo: a 302 from the function, then the
//                signed Cloud Storage URL. Up to 8 hero photos, then card
//                photos as the diner scrolls. Six at a time, like a browser.
//   - order    → qr-order with the page's exact body; on `sitting_ended` it
//                resends once with no sitting, exactly as the page does
//   - check    → qr-order-status with the ids this phone placed
//   - bill     → qr-request-bill
//
// Every order attempt is logged as one `ORDER {json}` console line, which
// perf/verify.js reads back against Firestore. Run k6 with
//   --console-output perf/out/<run>/orders.log
// =============================================================================

import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';
import exec from 'k6/execution';

const fx = JSON.parse(open(__ENV.FIXTURES || '../../.fixtures.json'));

export const FN = __ENV.FN_BASE || fx.functions_base;
export const RUN = __ENV.RUN || 'adhoc';
export const ITEMS = fx.items;
export const OUTLETS = fx.outlets;

/** Tables of the first `n` outlets, each tagged with its outlet name. */
export function tables(n = 1) {
    return fx.outlets.slice(0, Math.max(1, Math.min(n, fx.outlets.length)))
        .flatMap((o) => o.tables.map((t) => ({ ...t, outlet: o.name, outlet_id: o.id })));
}

export const refusals = new Counter('qr_refusals');          // tagged endpoint + reason
export const ordersAccepted = new Counter('orders_accepted');
export const orderOk = new Rate('order_ok');
export const firstPhoto = new Trend('first_photo_ms', true);
export const menuToPhotos = new Trend('photo_set_ms', true);

// Identifies the traffic in Netlify logs, and carries the perf allowance
// header when one is configured (docs/PERF_TEST_PLAN.md §7). `noAllowance`
// is for S7, which must run as a plain restaurant wifi.
function headers(extra = {}, { noAllowance = false } = {}) {
    const h = { 'User-Agent': 'FluxyOS-perf/1 (k6)', ...extra };
    if (__ENV.PERF_KEY && !noAllowance) h['x-fluxy-perf'] = __ENV.PERF_KEY;
    return h;
}

function note(res, endpoint) {
    if (res.status === 429) refusals.add(1, { endpoint, reason: 'rate_limited' });
    else if (res.status >= 400) {
        let reason = `http_${res.status}`;
        try { reason = (res.json() || {}).error || reason; } catch (_) { /* not json */ }
        refusals.add(1, { endpoint, reason });
    }
    return res;
}

export function openMenu(t, opts = {}) {
    const res = note(http.get(`${FN}qr-menu?token=${encodeURIComponent(t.token)}`,
        { headers: headers({}, opts), tags: { name: 'qr-menu' } }), 'qr-menu');
    if (res.status !== 200) return null;
    try { return res.json(); } catch (_) { return null; }
}

export function orderStatus(t, placed = [], opts = {}) {
    const ids = placed.length ? `&ids=${encodeURIComponent(placed.join(','))}` : '';
    const res = note(http.get(`${FN}qr-order-status?token=${encodeURIComponent(t.token)}${ids}`,
        { headers: headers({}, opts), tags: { name: 'qr-order-status' } }), 'qr-order-status');
    if (res.status !== 200) return null;
    try { return res.json(); } catch (_) { return null; }
}

/**
 * The photos a diner's screen asks for. `hero` from the rail (recommended
 * first), then `cards` in menu order as they scroll. Returns the number of
 * photos that arrived.
 */
export function browsePhotos(t, menu, { hero = 8, cards = 0 } = {}, opts = {}) {
    const items = (menu && menu.items) || [];
    const withPhoto = items.filter((i) => i.has_image);
    const rec = withPhoto.filter((i) => i.recommended);
    const heroPicks = (rec.length ? rec.concat(withPhoto.filter((i) => !i.recommended)) : withPhoto).slice(0, hero);
    const cardPicks = withPhoto.filter((i) => !heroPicks.includes(i)).slice(0, cards);
    const queue = heroPicks.concat(cardPicks);
    const started = Date.now();
    let got = 0; let first = null;
    for (let i = 0; i < queue.length; i += 6) {
        const chunk = queue.slice(i, i + 6);
        const hops = http.batch(chunk.map((it) => ['GET',
            `${FN}qr-menu-image?token=${encodeURIComponent(t.token)}&item=${encodeURIComponent(it.id)}`, null,
            { headers: headers({}, opts), redirects: 0, tags: { name: 'qr-menu-image' } }]));
        const follow = [];
        hops.forEach((r) => {
            note(r, 'qr-menu-image');
            const loc = r.headers.Location || r.headers.location;
            if (r.status === 302 && loc) follow.push(['GET', loc, null, { responseType: 'none', tags: { name: 'gcs-photo' } }]);
        });
        if (follow.length) {
            http.batch(follow).forEach((r) => {
                if (r.status === 200) {
                    got += 1;
                    if (first === null) { first = Date.now() - started; firstPhoto.add(first); }
                }
            });
        }
    }
    if (queue.length) menuToPhotos.add(Date.now() - started);
    return got;
}

/** 1–3 dishes, options chosen the way people choose them. */
export function buildCart(menu) {
    const items = ((menu && menu.items) || []).filter((i) => i.price > 0);
    const n = 1 + Math.floor(Math.random() * 3);
    const lines = [];
    for (let k = 0; k < n && items.length; k += 1) {
        const it = items[Math.floor(Math.random() * items.length)];
        const options = [];
        (it.modifier_groups || []).forEach((g) => {
            const pick = () => g.options[Math.floor(Math.random() * g.options.length)].id;
            if (g.select === 'one_required') options.push(pick());
            else if (g.select === 'one_optional' && Math.random() < 0.4) options.push(pick());
            else if (g.select === 'many') g.options.forEach((o) => { if (Math.random() < 0.3) options.push(o.id); });
        });
        lines.push({ item_id: it.id, quantity: 1 + (Math.random() < 0.25 ? 1 : 0), options, note: '' });
    }
    return lines;
}

export function newRef() {
    return `k6${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function logOrder(rec) { console.log(`ORDER ${JSON.stringify(rec)}`); }

/**
 * POST one order the way the page does. `state` is this phone's
 * { sitting, placed[] }, updated in place. Returns the response body or null.
 */
export function placeOrder(t, lines, state, { name = 'Load Test', phone = '081234567890', clientRef = newRef(), timeout = '30s', noAllowance = false, scenario = '' } = {}) {
    const send = (sitting) => {
        const t0 = Date.now();
        const res = http.post(`${FN}qr-order`, JSON.stringify({
            token: t.token, client_ref: clientRef, sitting, customer_name: name, customer_phone: phone, note: '', lines
        }), { headers: headers({ 'Content-Type': 'application/json' }, { noAllowance }), timeout, tags: { name: 'qr-order' } });
        let body = null;
        try { body = res.json(); } catch (_) { /* timeout or not json */ }
        logOrder({
            run: RUN, scenario: scenario || exec.scenario.name, vu: exec.vu.idInTest, iter: exec.vu.iterationInScenario,
            token: t.token, outlet: t.outlet, table: t.label, client_ref: clientRef, sitting_sent: sitting,
            http: res.status, error: (body && body.error) || (res.error || null), order_id: (body && body.order_id) || null,
            order_number: (body && body.order_number) || null, total_amount: (body && body.total_amount) || null,
            lines, at: new Date(t0).toISOString(), ms: Date.now() - t0
        });
        note(res, 'qr-order');
        return { res, body };
    };
    let { res, body } = send(state.sitting || null);
    if (res.status === 409 && body && body.error === 'sitting_ended') {
        state.sitting = null;
        ({ res, body } = send(null));
    }
    const ok = res.status === 200 && body && body.ok === true;
    orderOk.add(ok);
    if (!ok) return null;
    ordersAccepted.add(1);
    state.sitting = body.order_id || state.sitting;
    if (!state.placed.includes(body.order_id)) state.placed.push(body.order_id);
    return body;
}

export function requestBill(t, opts = {}) {
    const res = note(http.post(`${FN}qr-request-bill`, JSON.stringify({ token: t.token }),
        { headers: headers({ 'Content-Type': 'application/json' }, opts), tags: { name: 'qr-request-bill' } }), 'qr-request-bill');
    return res.status === 200;
}

/** Think time, scaled so a smoke run can compress a 45-minute sitting. */
export function think(minS, maxS) {
    const scale = Number(__ENV.THINK || __ENV.TIME || 1);
    sleep((minS + Math.random() * (maxS - minS)) * scale);
}

/**
 * One diner's whole visit: arrive, browse, 1–2 rounds, and — for the phone
 * that holds the table — ask for the bill.
 */
export function visit(t, { host = false, maxCards = 60 } = {}) {
    const state = { sitting: null, placed: [] };

    // Seat nobody at a table whose bill is still out: a host waits for the
    // cashier to clear it, rather than every new party hitting bill_requested.
    for (let tries = 0; tries < 10; tries += 1) {
        const s = orderStatus(t);
        if (!s || !s.has_order || s.status !== 'awaiting_payment') break;
        think(30, 30);
    }

    const menu = openMenu(t);
    if (!menu) return;
    const reconcile = orderStatus(t);
    if (reconcile && reconcile.has_order) state.sitting = reconcile.order_id;
    browsePhotos(t, menu, { hero: 8, cards: Math.floor(10 + Math.random() * (maxCards - 10)) });

    think(60, 180);                                    // choosing
    if (!placeOrder(t, buildCart(menu), state)) return;
    orderStatus(t, state.placed);

    if (Math.random() < 0.5) {                         // a second round
        think(480, 900);
        if (placeOrder(t, buildCart(menu), state)) orderStatus(t, state.placed);
    }

    think(600, 1200);                                  // eating
    if (host) {
        orderStatus(t, state.placed);
        requestBill(t);
    }
}
