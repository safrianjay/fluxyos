'use strict';
// =============================================================================
// scripts/cleanup-qa-test-data.js --pos, proved against the emulator.
//
// This script is run BY HAND against a real workspace, so its first execution
// must not also be its first test. What matters is not that it cleans, but what
// it REFUSES to touch: an `awaiting_payment` order has had money partially
// applied and voiding it strands a real payment; a `paid` one has posted
// revenue. And the fixture matcher has to tell "QA-BAR-1788…" from a genuine
// product called "QA-Special Blend".
//
// Run: firebase emulators:exec --config .rules-build/firebase.json --only \
//        firestore 'node tests/cleanup-pos.check.js'
// =============================================================================
const admin = require('firebase-admin');
const { execFileSync } = require('child_process');
if (!admin.apps.length) admin.initializeApp({ projectId: 'fluxyos' });
const db = admin.firestore();
const WS = 'CLEANUPCHECK';
const base = `workspaces/${WS}`;

const ORDERS = [
    ['o-open-1',    { status: 'open' }],
    ['o-open-2',    { status: 'open' }],
    ['o-served',    { status: 'served' }],
    ['o-sent',      { status: 'sent' }],
    ['o-awaiting',  { status: 'awaiting_payment' }],   // money landed — must survive
    ['o-paid',      { status: 'paid' }],               // posted — must survive
    ['o-void',      { status: 'void' }]                // already retired
];
const ITEMS = [
    ['i-qa-bar',   { name: 'QA-BAR-1788196352698', pos_visible: true }],
    ['i-qa-mod',   { name: 'QA-MOD-1788179029379', pos_visible: true }],
    ['i-rule',     { name: 'RULECHECK-9', pos_visible: true }],
    ['i-qa-hidden',{ name: 'QA-BAR-1788196352699', pos_visible: false }],
    ['i-real',     { name: 'Nasi Goreng', pos_visible: true }],      // must survive
    ['i-tricky',   { name: 'QA-Special Blend', pos_visible: true }], // must survive
    ['i-tricky2',  { name: 'Quality Coffee', pos_visible: true }]    // must survive
];

const run = (args) => execFileSync('node',
    ['scripts/cleanup-qa-test-data.js', '--workspace', WS, ...args],
    { encoding: 'utf8', cwd: __dirname + '/..', env: process.env });

(async () => {
    for (const [id, d] of ORDERS) await db.doc(`${base}/pos_orders/${id}`).set(d);
    for (const [id, d] of ITEMS) await db.doc(`${base}/items/${id}`).set(d);

    const dry = run(['--pos']);
    const after = async () => {
        const o = {}; (await db.collection(`${base}/pos_orders`).get()).forEach(d => o[d.id] = d.data().status);
        const i = {}; (await db.collection(`${base}/items`).get()).forEach(d => i[d.id] = !!d.data().pos_visible);
        return { o, i };
    };
    const s1 = await after();
    const fail = [];
    // Dry run must write NOTHING.
    ORDERS.forEach(([id, d]) => { if (s1.o[id] !== d.status) fail.push(`dry-run mutated order ${id}`); });
    ITEMS.forEach(([id, d]) => { if (s1.i[id] !== !!d.pos_visible) fail.push(`dry-run mutated item ${id}`); });
    if (!/4 stray to void/.test(dry)) fail.push('dry-run did not report 4 stray orders:\n' + dry);
    if (!/1 awaiting_payment left alone/.test(dry)) fail.push('dry-run did not warn about awaiting_payment');
    if (!/3 QA fixtures to un-publish/.test(dry)) fail.push('dry-run did not report 3 fixtures:\n' + dry);

    run(['--pos', '--commit']);
    const s2 = await after();
    const expectO = { 'o-open-1':'void','o-open-2':'void','o-served':'void','o-sent':'void',
                      'o-awaiting':'awaiting_payment','o-paid':'paid','o-void':'void' };
    Object.entries(expectO).forEach(([id, want]) => {
        if (s2.o[id] !== want) fail.push(`order ${id}: expected ${want}, got ${s2.o[id]}`);
    });
    const expectI = { 'i-qa-bar':false,'i-qa-mod':false,'i-rule':false,'i-qa-hidden':false,
                      'i-real':true,'i-tricky':true,'i-tricky2':true };
    Object.entries(expectI).forEach(([id, want]) => {
        if (s2.i[id] !== want) fail.push(`item ${id}: expected pos_visible=${want}, got ${s2.i[id]}`);
    });
    // A voided order must carry its reason — it is the only trace it leaves.
    const vr = (await db.doc(`${base}/pos_orders/o-open-1`).get()).data();
    if (!vr.void_reason) fail.push('voided order has no void_reason');
    if (!vr.voided_at) fail.push('voided order has no voided_at');

    if (fail.length) { console.error('FAIL\n - ' + fail.join('\n - ')); process.exit(1); }
    console.log('pos cleanup: 4 voided, 3 un-published; awaiting_payment/paid/real items untouched; reason stamped');
})().catch(e => { console.error(e); process.exit(1); });
