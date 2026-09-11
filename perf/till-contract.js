#!/usr/bin/env node
'use strict';
// =============================================================================
// perf/till-contract.js — the till's side of H1 (docs/data-model/pos.md §5b).
//
// The till read the WORKSPACE's newest 300 orders (the board) and listened to
// the newest 120 (the live listener), keeping one outlet's on the device. In a
// busy multi-outlet workspace every other outlet's orders spent that window.
//
// This opens a live order at one outlet, puts 310 newer orders at the OTHER
// outlets — more than both windows — then asks the till's own DataService
// (served from this checkout, signed in as qa+id, against production Firebase):
//   1. is the order still on the board (getPosOverview → activeOrders)?
//   2. does the live listener deliver a change to it?
//   3. does the archive guard see it (getLivePosOrders)?
//   4. does a shift tally still answer (getPosShiftTally, by shift id)?
// Orders are created by the real qr-order handler (run locally, as in
// perf/qr-contract.js) and each is voided straight after, so the next order at
// that table opens a new ticket. Everything is voided at the end.
//
//   node perf/till-contract.js
// =============================================================================

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'fluxyos' });
const { chromium } = require('playwright');
const { readCreds, readFixtures, ensureServer, signIn, withDataService } = require('./lib/session');
const { reset } = require('./reset');
const order = require('../netlify/functions/qr-order.js').handler;

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (a, b, label) => (JSON.stringify(a) === JSON.stringify(b) ? ok(label) : fail(`${label}\n      expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`));
const NEWER = Number(process.env.NEWER || 310);

async function place(t, plain, i) {
    const res = await order({
        httpMethod: 'POST',
        headers: { 'x-nf-client-connection-ip': `203.0.113.${(i % 200) + 1}`, origin: 'https://order.fluxyos.com' },
        body: JSON.stringify({ token: t.token, client_ref: `tillc${Date.now().toString(36)}${i}`, sitting: null, lines: [{ item_id: plain.id, quantity: 1, options: [] }] })
    });
    return JSON.parse(res.body);
}

(async () => {
    const fx = readFixtures();
    const db = admin.firestore();
    const col = db.collection(`workspaces/${fx.workspace_id}/pos_orders`);
    const kemang = fx.outlets.find((o) => o.name === 'Kemang');
    const others = fx.outlets.filter((o) => o.id !== kemang.id).flatMap((o) => o.tables);
    const plain = fx.items.find((i) => !i.modifier_groups.length);
    console.log(`\ntill contract — one live order at Kemang, then ${NEWER} newer orders at the other outlets\n`);
    console.log('  reset:', JSON.stringify(await reset({ log: () => {} })));

    const mine = await place(kemang.tables[2], plain, 0);
    if (!mine.ok) throw new Error(`could not open the Kemang order: ${JSON.stringify(mine)}`);
    console.log(`  Kemang table ${kemang.tables[2].label}: ${mine.order_number} (${mine.order_id})`);

    let made = 0;
    for (let i = 0; i < NEWER; i += 1) {
        const r = await place(others[i % others.length], plain, i + 1);
        if (r.ok) {
            made += 1;
            // Voided at once, so the next order at that table is a NEW document.
            await col.doc(r.order_id).update({ status: 'void', voided_at: admin.firestore.Timestamp.now(), void_reason: 'till contract filler' });
        }
        if ((i + 1) % 50 === 0) console.log(`  … ${i + 1} newer orders`);
    }
    is(made, NEWER, `${NEWER} newer orders landed at the other outlets`);

    const stop = await ensureServer();
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        page.on('console', (m) => { if (/\[pos\]/.test(m.text())) console.log('    page:', m.text().slice(0, 140)); });
        await signIn(page, readCreds('id'));

        const got = await withDataService(page, async ({ dim, id }) => {
            const { ds, uid } = window.__perf;
            const ov = await ds.getPosOverview(uid, { dimensionId: dim });
            const live = await ds.getLivePosOrders(uid, dim);
            const tally = await ds.getPosShiftTally(uid, 'till-contract-no-such-shift');
            window.__rows = null;
            window.__stopWatch = ds.watchPosOrders(uid, { dimensionId: dim }, (rows) => { window.__rows = rows.map((o) => [o.id, o.status]); });
            return {
                onBoard: (ov.activeOrders || []).some((o) => o.id === id),
                guard: live.some((o) => o.id === id),
                tally: tally && typeof tally.order_count === 'number' ? tally.order_count : 'no tally'
            };
        }, { dim: kemang.id, id: mine.order_id });
        is(got.onBoard, true, 'the Kemang order is still on the board (getPosOverview)');
        is(got.guard, true, 'the archive guard finds it (getLivePosOrders)');
        is(got.tally, 0, 'a shift tally answers, by shift id (0 orders for an unknown shift)');

        await page.waitForFunction(() => Array.isArray(window.__rows), null, { timeout: 30_000 }).catch(() => {});
        const first = await page.evaluate(() => window.__rows);
        is(Array.isArray(first) && first.some(([id]) => id === mine.order_id), true, 'the live listener\'s first delivery includes it');
        await col.doc(mine.order_id).update({ status: 'sent', status_changed_at: admin.firestore.Timestamp.now() });
        const heard = await page.waitForFunction((id) => Array.isArray(window.__rows) && window.__rows.some(([i, s]) => i === id && s === 'sent'),
            mine.order_id, { timeout: 20_000 }).then(() => true).catch(() => false);
        is(heard, true, 'a change to it reaches the live listener');
        await page.evaluate(() => window.__stopWatch && window.__stopWatch());
    } finally {
        await browser.close();
        stop();
    }
    console.log('  reset:', JSON.stringify(await reset({ log: () => {} })));
    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\ntill contract: clean\n');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('\n✗ till contract threw:', e && e.stack || e); process.exit(1); });
