#!/usr/bin/env node
'use strict';
// =============================================================================
// perf/cashier.js — a scripted cashier and kitchen for the load runs.
//
// Most order CHANGES in a real service come from staff, not diners: every
// ticket is sent to the kitchen, marked ready, marked served, and settled. Each
// of those is a write the till's live listener hears, and each is therefore a
// full refresh on every open till (plan hypothesis H2). A load test with no
// cashier measures a restaurant where nobody works.
//
// Timings (× --speed; 0.1 makes a 4-minute cook 24 seconds):
//   submitted        → sent               after ~20 s   (cashier acknowledges)
//   sent             → ready              after 3–6 min (the kitchen)
//   ready            → served             after ~60 s   (runner)
//   awaiting_payment → void               after ~2 min  (see below)
//
// ⚠️ A REQUESTED BILL IS VOIDED, NOT PAID. Paying posts journals, and the
// load-test ledger would accumulate thousands of immutable entries per run.
// The void frees the table exactly as payment does for the next party (both
// end the sitting). What this does NOT exercise is the payment write itself —
// `payPosTableBill` — which is measured once in S1 instead.
//
// Every write goes through DataService (the till's own methods, the real
// rules), sequentially, the way one cashier works. Each is logged with its
// latency to perf/out/<run>/cashier.ndjson.
//
//   node perf/cashier.js --run s3 --minutes 90
//   node perf/cashier.js --run s4 --minutes 5 --speed 0.1
// =============================================================================

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { readCreds, ensureServer, signIn, withDataService, outDir } = require('./lib/session');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const RUN = flag('run', 'adhoc');
const MINUTES = Number(flag('minutes', 90));
const SPEED = Number(flag('speed', 1));

const ACK_S = 20 * SPEED;
const COOK_S = [180 * SPEED, 360 * SPEED];
const RUN_S = 60 * SPEED;
const PAY_S = 120 * SPEED;

async function main() {
    const creds = readCreds(flag('account', 'id'));
    const stop = await ensureServer();
    const browser = await chromium.launch();
    const logFile = path.join(outDir(RUN), 'cashier.ndjson');
    const out = fs.createWriteStream(logFile, { flags: 'a' });
    const counts = {};
    let stopping = false;
    process.on('SIGINT', () => { stopping = true; });

    try {
        const page = await browser.newPage();
        await signIn(page, creds);
        // One listener, like a till — not a poll. The poll below is only the
        // fallback for orders that fall outside the listener's 120-order window.
        await withDataService(page, () => {
            const { ds, uid } = window.__perf;
            window.__perfRows = new Map();
            window.__perfUnwatch = ds.watchPosOrders(uid, {}, (rows) => {
                rows.forEach((r) => window.__perfRows.set(r.id, r));
            });
        });
        console.log(`[perf-cashier] on shift for ${MINUTES} min at speed ${SPEED} → ${path.relative(process.cwd(), logFile)}`);

        const end = Date.now() + MINUTES * 60_000;
        let lastPoll = 0;
        while (!stopping && Date.now() < end) {
            const poll = Date.now() - lastPoll > 120_000;
            if (poll) lastPoll = Date.now();
            const actions = await withDataService(page, async ({ ACK_S, COOK_S, RUN_S, PAY_S, poll }) => {
                const { ds, uid } = window.__perf;
                if (poll) {
                    (await ds.getPosOrders(uid, { limitCount: 1000 })).forEach((r) => window.__perfRows.set(r.id, r));
                }
                const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);
                const now = Date.now();
                // A deterministic cook time per order, so a re-read never re-rolls it.
                const cookFor = (id) => COOK_S[0] + ([...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 100) / 100 * (COOK_S[1] - COOK_S[0]);
                const done = [];
                for (const o of window.__perfRows.values()) {
                    if (o.voided_at || o.status === 'void' || o.status === 'paid') continue;
                    const since = (now - (ms(o.status_changed_at) || ms(o.updated_at) || ms(o.created_at))) / 1000;
                    let next = null;
                    if (o.status === 'submitted' && since >= ACK_S) next = 'sent';
                    else if (o.status === 'sent' && since >= cookFor(o.id)) next = 'ready';
                    else if (o.status === 'ready' && since >= RUN_S) next = 'served';
                    else if (o.status === 'awaiting_payment' && since >= PAY_S) next = 'void';
                    if (!next) continue;
                    const t0 = performance.now();
                    try {
                        const res = next === 'void'
                            ? await ds.voidPosOrder(uid, o.id, 'Load test: bill settled')
                            : await ds.setPosOrderStatus(uid, o.id, next);
                        window.__perfRows.set(o.id, { ...o, ...res, status: next, status_changed_at: { toMillis: () => Date.now() } });
                        done.push({ order_id: o.id, number: o.order_number, from: o.status, to: next, ms: Math.round(performance.now() - t0), ok: true });
                    } catch (e) {
                        done.push({ order_id: o.id, number: o.order_number, from: o.status, to: next, ms: Math.round(performance.now() - t0), ok: false, error: e.message });
                    }
                }
                return done;
            }, { ACK_S, COOK_S, RUN_S, PAY_S, poll });
            for (const a of actions) {
                out.write(JSON.stringify({ at: new Date().toISOString(), ...a }) + '\n');
                const k = `${a.from}→${a.to}${a.ok ? '' : ' FAILED'}`;
                counts[k] = (counts[k] || 0) + 1;
                if (!a.ok) console.log(`[perf-cashier] ${a.number || a.order_id} ${k}: ${a.error}`);
            }
            await new Promise((r) => setTimeout(r, 3000));
        }
    } finally {
        out.end();
        await browser.close();
        stop();
        console.log('[perf-cashier] off shift:', JSON.stringify(counts));
    }
}

main().catch((e) => { console.error('[perf-cashier] FAILED:', e.message); process.exit(1); });
