#!/usr/bin/env node
'use strict';
// =============================================================================
// perf/verify.js — did every order the load generator was told it placed
// actually land, once, on the right table, at the right price?
//
// This is the plan's HARD budget (docs/PERF_TEST_PLAN.md §6). Latency can be
// argued about; a lost or doubled order cannot.
//
// Reads the `ORDER {json}` lines k6 wrote (perf/k6/lib/diner.js) and every
// pos_order in the load-test workspace created since the run began, then checks:
//
//   1. FOUND        every accepted order_id exists
//   2. TABLE        …on the table whose token placed it
//   3. LINES        per order, the quantity of each dish+options equals what
//                   the accepted requests sent (one per client_ref — a retry
//                   that was answered from the idempotency record adds nothing)
//   4. PRICE        subtotal = Σ lines, and total = pos-pricing.js applied to
//                   the order's own rate snapshot
//   5. NUMBERS      order numbers unique and gap-free per outlet per day
//   6. GHOSTS       orders written with no accepted response (a client that
//                   timed out while the server carried on — S10's question)
//   7. IDEMPOTENCY  no client_ref produced two different order ids
//
// Read-only. Uses gcloud application-default credentials (firebase-admin).
//
//   node perf/verify.js --log perf/out/s3-1x/orders.log
//   node perf/verify.js --log perf/out/s4/orders.log --json perf/out/s4/verify.json
// =============================================================================

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const pricing = require('../assets/js/pos-pricing.js');
const { readFixtures } = require('./lib/session');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d; };

/** k6 writes console lines as logfmt (`msg="ORDER {\"a\":1}"`) or raw; accept both. */
function readLog(file) {
    const recs = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const at = line.indexOf('ORDER {');
        if (at < 0) continue;
        let json = line.slice(at + 6);
        if (/^msg="/.test(line.slice(line.indexOf('msg='), line.indexOf('msg=') + 5))) {
            const m = /msg="ORDER (\{.*\})" /.exec(line) || /msg="ORDER (\{.*\})"$/.exec(line);
            if (m) json = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
        try { recs.push(JSON.parse(json)); } catch (_) { /* a truncated line */ }
    }
    return recs;
}

const lineKey = (itemId, optionIds) => `${itemId}|${[...optionIds].sort().join(',')}`;

async function verify({ logFile, workspaceId, since }) {
    const fx = readFixtures();
    const ws = workspaceId || fx.workspace_id;
    const recs = readLog(logFile);
    if (!recs.length) throw new Error(`No ORDER lines in ${logFile}.`);
    const start = since ? new Date(since) : new Date(Math.min(...recs.map((r) => Date.parse(r.at))) - 60_000);

    if (!admin.apps.length) admin.initializeApp({ projectId: 'fluxyos' });
    const db = admin.firestore();
    const snap = await db.collection(`workspaces/${ws}/pos_orders`).where('created_at', '>=', start).get();
    const orders = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    const tableOfToken = new Map(fx.outlets.flatMap((o) => o.tables.map((t) => [t.token, { ...t, outlet_id: o.id, outlet: o.name }])));

    const accepted = recs.filter((r) => r.http === 200 && r.order_id);
    const problems = { missing: [], wrong_table: [], lines: [], price: [], numbers: [], ghosts: [], idempotency: [] };

    // 7. One order id per client_ref.
    const byRef = new Map();
    accepted.forEach((r) => {
        const k = `${r.token}_${r.client_ref}`;
        if (!byRef.has(k)) byRef.set(k, new Set());
        byRef.get(k).add(r.order_id);
    });
    byRef.forEach((ids, k) => { if (ids.size > 1) problems.idempotency.push({ client_ref: k.split('_').pop(), order_ids: [...ids] }); });

    // Expected lines per order: the FIRST accepted response per client_ref counts.
    const expected = new Map();
    const counted = new Set();
    accepted.forEach((r) => {
        const k = `${r.token}_${r.client_ref}`;
        if (counted.has(k)) return;
        counted.add(k);
        if (!expected.has(r.order_id)) expected.set(r.order_id, { token: r.token, lines: new Map(), refs: [] });
        const e = expected.get(r.order_id);
        e.refs.push(r.client_ref);
        (r.lines || []).forEach((l) => {
            const key = lineKey(l.item_id, l.options || []);
            e.lines.set(key, (e.lines.get(key) || 0) + Number(l.quantity || 0));
        });
    });

    expected.forEach((e, orderId) => {
        const o = orders.get(orderId);
        if (!o) { problems.missing.push(orderId); return; }                              // 1
        const t = tableOfToken.get(e.token);
        if (!t || o.table_id !== t.id) problems.wrong_table.push({ order_id: orderId, expected: t && t.id, got: o.table_id }); // 2

        const got = new Map();                                                           // 3
        (o.lines || []).forEach((l) => {
            const key = lineKey(l.item_id, (l.modifiers || []).map((m) => m.option_id));
            got.set(key, (got.get(key) || 0) + Number(l.quantity || 0));
        });
        const keys = new Set([...got.keys(), ...e.lines.keys()]);
        const diff = [...keys].filter((k) => (got.get(k) || 0) !== (e.lines.get(k) || 0))
            .map((k) => ({ line: k, sent: e.lines.get(k) || 0, stored: got.get(k) || 0 }));
        if (diff.length) problems.lines.push({ order_id: orderId, number: o.order_number, diff });

        const subtotal = (o.lines || []).reduce((s, l) => s + Number(l.gross_amount || 0), 0); // 4
        const want = pricing.computeBillTotals({ subtotal, discountTotal: Number(o.discount_total || 0), settings: o.pos_pricing || null });
        if (Number(o.subtotal) !== subtotal || Number(o.total_amount) !== want.total) {
            problems.price.push({ order_id: orderId, number: o.order_number, subtotal_stored: o.subtotal, subtotal_lines: subtotal, total_stored: o.total_amount, total_expected: want.total });
        }
    });

    // 5. Numbers: every order of the day per outlet, not just this run's — a
    //    gap is a gap whoever caused it.
    const days = new Map();
    orders.forEach((o) => {
        const m = /^(.+)-(\d+)$/.exec(String(o.order_number || ''));
        if (!m) return;
        const k = `${o.dimension_id}|${m[1]}`;
        if (!days.has(k)) days.set(k, []);
        days.get(k).push(Number(m[2]));
    });
    for (const [k, seqs] of days) {
        const [dim, day] = k.split('|');
        const all = (await db.collection(`workspaces/${ws}/pos_orders`).where('dimension_id', '==', dim).get()).docs
            .map((d) => String(d.data().order_number || '')).filter((n) => n.startsWith(`${day}-`))
            .map((n) => Number(n.split('-').pop())).sort((a, b) => a - b);
        const dupes = all.filter((n, i) => all.indexOf(n) !== i);
        const gaps = [];
        for (let n = 1; n <= (all[all.length - 1] || 0); n += 1) if (!all.includes(n)) gaps.push(n);
        if (dupes.length || gaps.length) problems.numbers.push({ outlet: dim, day, dupes, gaps, count: all.length });
        void seqs;
    }

    // 6. Ghosts: written during the run, never acknowledged, not a till order.
    const acked = new Set(accepted.map((r) => r.order_id));
    orders.forEach((o) => { if (o.channel === 'qr' && !acked.has(o.id)) problems.ghosts.push({ order_id: o.id, number: o.order_number, table: o.table_label }); });

    const refused = recs.filter((r) => r.http !== 200);
    const reasons = {};
    refused.forEach((r) => { const k = `${r.http} ${r.error || ''}`.trim(); reasons[k] = (reasons[k] || 0) + 1; });

    const hard = problems.missing.length + problems.wrong_table.length + problems.lines.length
        + problems.price.length + problems.numbers.length + problems.idempotency.length;
    return {
        log: logFile, workspace: ws, since: start.toISOString(),
        attempts: recs.length, accepted: accepted.length, unique_client_refs: counted.size,
        orders_checked: expected.size, orders_in_window: orders.size, refused: reasons,
        problems, pass: hard === 0 && accepted.length > 0, inconclusive: accepted.length === 0,
        ghosts: problems.ghosts.length
    };
}

if (require.main === module) {
    const logFile = flag('log', null);
    if (!logFile) { console.error('usage: node perf/verify.js --log perf/out/<run>/orders.log [--json out.json] [--since ISO]'); process.exit(2); }
    verify({ logFile, since: flag('since', null) }).then((r) => {
        const P = r.problems;
        console.log(`[perf-verify] ${r.attempts} attempts · ${r.accepted} accepted · ${r.orders_checked} orders checked · ${r.orders_in_window} in window`);
        if (Object.keys(r.refused).length) console.log('[perf-verify] refused:', JSON.stringify(r.refused));
        const row = (name, list) => console.log(`  ${list.length ? '✗' : '✓'} ${name.padEnd(12)} ${list.length ? `${list.length} — ${JSON.stringify(list.slice(0, 3))}` : 'ok'}`);
        row('found', P.missing); row('table', P.wrong_table); row('lines', P.lines); row('price', P.price);
        row('numbers', P.numbers); row('idempotency', P.idempotency);
        console.log(`  ${P.ghosts.length ? '!' : '✓'} ${'ghosts'.padEnd(12)} ${P.ghosts.length ? `${P.ghosts.length} written without an accepted response` : 'none'}`);
        console.log(r.inconclusive
            ? '[perf-verify] INCONCLUSIVE — no order was accepted, so nothing was verified'
            : `[perf-verify] ${r.pass ? 'PASS' : 'FAIL'} — hard budgets ${r.pass ? 'held' : 'broken'}`);
        const out = flag('json', path.join(path.dirname(logFile), 'verify.json'));
        fs.writeFileSync(out, JSON.stringify(r, null, 2));
        process.exit(r.pass ? 0 : 1);
    }).catch((e) => { console.error('[perf-verify] FAILED:', e.message); process.exit(2); });
}

module.exports = { verify, readLog };
