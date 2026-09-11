#!/usr/bin/env node
'use strict';
// =============================================================================
// perf/qr-contract.js — run the five REAL QR functions, locally, against the
// load-test workspace, and check every answer a diner's phone depends on.
//
// Written for the 2026-09-11 round-trip rework (docs/perf/S1_BASELINE_2026-09-11.md,
// F2): the handlers were restructured to make two parallel batches instead of
// up to fourteen sequential reads, and the idempotency record moved inside the
// order transaction. Static checks cannot prove that behaves the same; this
// runs the actual code on real Firestore data — the `qa+id` workspace — before
// it ever reaches a diner.
//
// Runs from this machine with gcloud application-default credentials: the
// admin app is initialised here first, so each handler's initAdmin() finds it
// and never needs FIREBASE_SERVICE_ACCOUNT. Storage signing needs a service
// account key this machine does not have, so the signer is replaced with a fake
// that returns a recognisable URL — everything else is the real path.
//
// Voids everything it created (perf/reset.js). Exit 1 on any broken expectation.
//
//   node perf/qr-contract.js
// =============================================================================

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'fluxyos', storageBucket: 'fluxyos.firebasestorage.app' });
const { File } = require('@google-cloud/storage');
File.prototype.getSignedUrl = async function fakeSign() {
    return [`https://signed.test/${this.name}?at=${Date.now()}`];
};

const pricing = require('../assets/js/pos-pricing.js');
const { readFixtures } = require('./lib/session');
const { reset } = require('./reset');

const H = {
    menu: require('../netlify/functions/qr-menu.js').handler,
    image: require('../netlify/functions/qr-menu-image.js').handler,
    order: require('../netlify/functions/qr-order.js').handler,
    status: require('../netlify/functions/qr-order-status.js').handler,
    bill: require('../netlify/functions/qr-request-bill.js').handler
};

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (actual, expected, label) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
    else fail(`${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

const IP = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
const headers = { 'x-nf-client-connection-ip': IP, origin: 'https://order.fluxyos.com' };
const timings = {};
async function call(name, { query = null, body = null, ip = null } = {}) {
    const t0 = Date.now();
    const res = await H[name]({
        httpMethod: body ? 'POST' : 'GET',
        headers: ip ? { ...headers, 'x-nf-client-connection-ip': ip } : headers,
        queryStringParameters: query, body: body ? JSON.stringify(body) : null
    });
    (timings[name] = timings[name] || []).push(Date.now() - t0);
    if (res.headers && res.headers['Server-Timing'] && process.env.TRACE) {
        console.log(`    ${name} ${res.statusCode} ${Date.now() - t0}ms · ${res.headers['Server-Timing']}`);
    }
    let json = null;
    try { json = JSON.parse(res.body); } catch (_) { /* image / text */ }
    return { status: res.statusCode, headers: res.headers || {}, json };
}
const ref = (tag) => `contract${tag}${Date.now().toString(36)}`;

(async () => {
    const fx = readFixtures();
    const outlet = fx.outlets.find((o) => o.name === 'Senopati') || fx.outlets[fx.outlets.length - 1];
    const T = outlet.tables[outlet.tables.length - 1];
    const db = admin.firestore();
    const orderDoc = (id) => db.doc(`workspaces/${fx.workspace_id}/pos_orders/${id}`);
    console.log(`\nqr contract — ${outlet.name} table ${T.label}, as ${IP}\n`);
    console.log('  reset:', JSON.stringify(await reset({ log: () => {} })));

    // ── Menu ────────────────────────────────────────────────────────────────
    const m1 = await call('menu', { query: { token: T.token } });
    is(m1.status, 200, 'qr-menu answers 200');
    is(m1.json && m1.json.outlet, outlet.name, '…for the outlet the table is in');
    is(m1.json && m1.json.table, T.label, '…and the table');
    is(m1.json && m1.json.items.length, fx.items.length, `…with every visible dish (${fx.items.length})`);
    is(m1.json && m1.json.currency, 'IDR', '…in the workspace currency');
    is(m1.json && m1.json.pricing && m1.json.pricing.tax_rate_percent, 11, '…with the outlet rates');
    is(/stale-while-revalidate/.test(m1.headers['Netlify-CDN-Cache-Control'] || ''), true, '…and an edge cache instruction');
    const m2 = await call('menu', { query: { token: T.token } });
    is(m2.json && JSON.stringify(m2.json), m1.json && JSON.stringify(m1.json), 'a second load (warm) returns the identical menu');
    is((await call('menu', { query: { token: 'contractNoSuchToken123' } })).status, 404, 'an unknown token is 404');

    // ── Photo ───────────────────────────────────────────────────────────────
    const dish = fx.items.find((i) => i.has_photo);
    const p1 = await call('image', { query: { token: T.token, item: dish.id } });
    is(p1.status, 302, 'a photo redirects');
    is(/^https:\/\/signed\.test\/workspaces\//.test(p1.headers.Location || ''), true, '…to a signed URL for this workspace');
    const p2 = await call('image', { query: { token: T.token, item: dish.id } });
    is(p2.headers.Location, p1.headers.Location, 'a second request reuses the signed URL');
    const maxAge = Number(/max-age=(\d+)/.exec(p2.headers['Cache-Control'] || '')[1]);
    is(maxAge <= 1800 && maxAge >= 60, true, `…with a cache life no longer than 30 min (${maxAge}s)`);
    is((await call('image', { query: { token: T.token, item: 'contractNoSuchItem' } })).status, 404, 'an unknown dish is 404');

    // ── Status before anything is ordered ───────────────────────────────────
    const s0 = await call('status', { query: { token: T.token } });
    is(s0.status === 200 && s0.json.has_order, false, 'qr-order-status: an empty table has no order');

    // ── Order: new ticket, priced by the server ─────────────────────────────
    const plain = fx.items.find((i) => !i.modifier_groups.length);
    const tea = fx.items.find((i) => i.modifier_groups.some((g) => g.select === 'one_required'));
    const req = g => g.options[0].id;
    const teaOpts = tea.modifier_groups.filter((g) => g.select === 'one_required').map(req);
    const lines1 = [{ item_id: plain.id, quantity: 2, options: [], note: '' }, { item_id: tea.id, quantity: 1, options: teaOpts, note: '' }];
    const A = ref('a');
    const o1 = await call('order', { body: { token: T.token, client_ref: A, sitting: null, customer_name: 'Contract', customer_phone: '081234567890', lines: lines1 } });
    is(o1.status, 200, 'qr-order opens a new ticket');
    const doc1 = (await orderDoc(o1.json.order_id).get()).data();
    const sub1 = plain.price * 2 + tea.price;
    is(doc1.subtotal, sub1, `…priced from the menu, never the request (subtotal ${sub1})`);
    is(doc1.total_amount, pricing.computeBillTotals({ subtotal: sub1, discountTotal: 0, settings: doc1.pos_pricing }).total, '…with the outlet rates applied');
    is(o1.json.total_amount, doc1.total_amount, '…and the diner is told the same total the order holds');
    is(doc1.status, 'submitted', '…waiting for the till');
    const idem = await db.doc(`qr_order_refs/${T.token}_${A}`).get();
    is(idem.exists && idem.data().order_id, o1.json.order_id, '…with its idempotency record written alongside');

    // ── The same tap again ──────────────────────────────────────────────────
    const o1b = await call('order', { body: { token: T.token, client_ref: A, sitting: null, lines: lines1 } });
    is([o1b.status, o1b.json.duplicate, o1b.json.order_id], [200, true, o1.json.order_id], 'a retry with the same client_ref returns the same order');

    // ── Two identical taps AT THE SAME MOMENT (the race S10 was written for) ─
    const B = ref('b');
    const lines2 = [{ item_id: plain.id, quantity: 1, options: [], note: '' }];
    const [r1, r2] = await Promise.all([
        call('order', { body: { token: T.token, client_ref: B, sitting: o1.json.order_id, lines: lines2 } }),
        call('order', { body: { token: T.token, client_ref: B, sitting: o1.json.order_id, lines: lines2 } })
    ]);
    is([r1.status, r2.status], [200, 200], 'two simultaneous copies of one order both get an answer');
    is(r1.json.order_id === r2.json.order_id, true, '…the same order');
    const doc2 = (await orderDoc(o1.json.order_id).get()).data();
    const plainQty = doc2.lines.filter((l) => l.item_id === plain.id).reduce((s, l) => s + l.quantity, 0);
    is(plainQty, 3, '…and the dish was added ONCE (2 + 1), not twice');

    // ── A second round appends while the till has not sent it ──────────────
    const C = ref('c');
    const o3 = await call('order', { body: { token: T.token, client_ref: C, sitting: o1.json.order_id, lines: [{ item_id: tea.id, quantity: 1, options: teaOpts, note: '' }] } });
    is([o3.status, o3.json.order_id], [200, o1.json.order_id], 'a round before the kitchen has the ticket appends to it');

    // ── The kitchen takes it; the next round is a NEW ticket, same sitting ──
    await orderDoc(o1.json.order_id).update({ status: 'sent', status_changed_at: admin.firestore.Timestamp.now(), version: admin.firestore.FieldValue.increment(1) });
    const D = ref('d');
    const o4 = await call('order', { body: { token: T.token, client_ref: D, sitting: o1.json.order_id, lines: lines2 } });
    is(o4.status, 200, 'after the kitchen has it, the next round is accepted');
    is(o4.json.order_id !== o1.json.order_id, true, '…as a NEW ticket, never merged into food already cooking');
    const doc4 = (await orderDoc(o4.json.order_id).get()).data();
    is(JSON.stringify(doc4.pos_pricing), JSON.stringify(doc1.pos_pricing), '…at the rates the sitting opened with');
    const n1 = Number(String(doc1.order_number).split('-').pop());
    const n4 = Number(String(doc4.order_number).split('-').pop());
    is(n4, n1 + 1, `…numbered next in sequence (${doc1.order_number} → ${doc4.order_number})`);

    // ── A sitting that is not this table's ──────────────────────────────────
    const bogus = await call('order', { body: { token: T.token, client_ref: ref('e'), sitting: 'contractNoSuchSitting', lines: lines2 } });
    is([bogus.status, bogus.json.error], [409, 'sitting_ended'], 'an unknown sitting is refused sitting_ended');

    // ── Status shows the whole sitting ──────────────────────────────────────
    const s1 = await call('status', { query: { token: T.token, ids: [o1.json.order_id, o4.json.order_id].join(',') } });
    is(s1.status, 200, 'qr-order-status answers');
    is(s1.json.has_order, true, '…with the table\'s order');
    is((s1.json.orders || []).length, 2, '…listing both live tickets');
    const t1 = (await orderDoc(o1.json.order_id).get()).data().total_amount;
    is([s1.json.session && s1.json.session.order_count, s1.json.session && s1.json.session.total_amount], [2, t1 + doc4.total_amount],
        '…and one bill for both: the session total is the sum of the two tickets');

    // ── The bill, and nothing behind it ─────────────────────────────────────
    const b1 = await call('bill', { body: { token: T.token } });
    is([b1.status, b1.json.ok, b1.json.order_count], [200, true, 2], 'qr-request-bill moves BOTH tickets to awaiting payment');
    const b2 = await call('bill', { body: { token: T.token } });
    is([b2.status, b2.json.already], [200, true], 'a second tap moves nothing and says so');
    const behind = await call('order', { body: { token: T.token, client_ref: ref('f'), sitting: null, lines: lines2 } });
    is([behind.status, behind.json.error], [409, 'bill_requested'], 'no new ticket opens behind a requested bill');

    // ── H1: a table must not vanish behind 50 newer orders ──────────────────
    // The lunch rush lost 36 live sittings this way (docs/perf/LOAD_2026-09-11.md).
    // Open a sitting, push 52 newer orders onto OTHER tables, then ask the
    // three questions the diner's phone asks.
    await reset({ log: () => {} });
    const Hn = outlet.tables[outlet.tables.length - 2];
    const hState = await call('order', { body: { token: Hn.token, client_ref: ref('h1'), sitting: null, lines: lines2 } });
    is(hState.status, 200, 'H1: table opens a sitting');
    const others = fx.outlets.flatMap((o) => o.tables).filter((t) => t.token !== Hn.token && t.token !== T.token).slice(0, 52);
    let placed = 0;
    for (let i = 0; i < others.length; i += 1) {
        // A different address per order: this is 52 restaurants' worth of
        // diners, not one phone, and the per-IP order limit is 20 a minute.
        const r = await call('order', { body: { token: others[i].token, client_ref: ref(`n${i}`), sitting: null, lines: lines2 }, ip: `203.0.113.${(i % 200) + 1}` });
        if (r.status === 200) placed += 1;
    }
    is(placed, 52, 'H1: 52 newer orders land on other tables');
    const hStatus = await call('status', { query: { token: Hn.token, ids: hState.json.order_id } });
    is(hStatus.json && hStatus.json.order_id, hState.json.order_id, 'H1: after 52 newer orders the table still sees its own order');
    const hRound = await call('order', { body: { token: Hn.token, client_ref: ref('h2'), sitting: hState.json.order_id, lines: lines2 } });
    is([hRound.status, hRound.json.order_id], [200, hState.json.order_id], 'H1: round two joins the sitting instead of being told it ended');
    const hBill = await call('bill', { body: { token: Hn.token } });
    is([hBill.status, hBill.json.ok], [200, true], 'H1: the table can still ask for its bill');
    const hBehind = await call('order', { body: { token: Hn.token, client_ref: ref('h3'), sitting: null, lines: lines2 } });
    is([hBehind.status, hBehind.json.error], [409, 'bill_requested'], 'H1: and nothing opens behind that bill');

    // ── Round trips, for the record (from Jakarta, ~50 ms each — not prod) ──
    console.log('\n  local timings (ms):', JSON.stringify(Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, v]))));
    console.log('  reset:', JSON.stringify(await reset({ log: () => {} })));
    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nqr contract: clean\n');
    process.exit(failures ? 1 : 0);
})().catch((err) => {
    console.error('\n✗ qr contract threw:', err && err.stack || err);
    process.exit(1);
});
