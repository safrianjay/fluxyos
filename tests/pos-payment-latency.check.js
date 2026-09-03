'use strict';

// =============================================================================
// Taking payment does not make the cashier wait for the ledger.
//
// THE COMPLAINT. Confirming a payment on the till sat on a spinner for seconds
// with a customer standing at the counter.
//
// THE CAUSE. `recordPosPayment` awaited `_emitPosSale`, and emission rebuilds
// the cost basis by reading EVERY item plus up to 1000 stock movements.
// Measured against a real 467-item workspace from a server: 610ms for items,
// 1024ms for movements, in parallel — and a browser on restaurant wifi is
// several times that, before the journal posting and the batch commit.
//
// WHY IT IS SAFE NOT TO WAIT. The money is recorded by the order write, which
// happens BEFORE emission. Emission was already best-effort: it is wrapped in a
// catch, retried by `emitUnpostedPosSales`, and its backlog is surfaced on the
// POS overview. Waiting for it bought immediacy, not correctness.
//
// This drives the real method with fakes, so it measures the ORDERING rather
// than the network: no Firestore, no browser.
//
// Run: node tests/pos-payment-latency.check.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'assets/js/pos-service.js'), 'utf8');
const TILL = fs.readFileSync(path.join(ROOT, 'assets/js/pos.js'), 'utf8');

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (actual, expected, label) => {
    if (actual === expected) ok(label);
    else fail(`${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

/** Pull `recordPosPayment` out of the module and bind it to a stub. */
function methodUnder(name) {
    const start = SRC.indexOf(`    async ${name}(`);
    if (start === -1) throw new Error(`${name} not found in pos-service.js`);
    const end = SRC.indexOf('\n    },\n', start);
    if (end === -1) throw new Error(`could not find the end of ${name}`);
    const body = SRC.slice(start, end + 6);
    // eslint-disable-next-line no-new-func
    return new Function('POS_PAYMENT_METHODS', 'Timestamp', `return ({ ${body} });`)(
        [{ id: 'cash', tender: 'cash' }, { id: 'qris', tender: 'external' }],
        { fromDate: (d) => d }
    );
}

(async () => {
    console.log('\npos payment latency\n');

    const EMIT_MS = 300;   // stands in for the item + movement reads
    const host = methodUnder('recordPosPayment');
    let emitStarted = 0; let emitFinished = 0;

    host._posTenderFor = (m) => (m === 'cash' ? 'cash' : 'external');
    host._nullableString = (v) => (v == null ? null : String(v));
    host._posTotals = (o) => ({
        paid_amount: (o.payments || []).reduce((s, p) => s + p.amount, 0),
        total_amount: 50000
    });
    host.updatePosOrder = async (uid, id, fn) => {
        const base = { id, status: 'awaiting_payment', lines: [{ item_id: 'x' }], payments: [] };
        return { ...base, ...fn(base) };
    };
    host._emitPosSale = () => {
        emitStarted = Date.now();
        return new Promise((r) => setTimeout(() => { emitFinished = Date.now(); r(); }, EMIT_MS));
    };

    // ── The default is unchanged: callers that did wait, still wait ─────────
    let t0 = Date.now();
    await host.recordPosPayment('u', 'o1', { method: 'cash', amount: 50000, amountReceived: 50000 });
    const waited = Date.now() - t0;
    is(waited >= EMIT_MS, true,
        `awaitEmit defaults to true — the call took ${waited}ms (>= ${EMIT_MS}ms)`);

    // ── THE FIX: the till gets its order back immediately ──────────────────
    emitStarted = 0; emitFinished = 0;
    t0 = Date.now();
    const order = await host.recordPosPayment('u', 'o2', {
        method: 'cash', amount: 50000, amountReceived: 50000, awaitEmit: false
    });
    const returned = Date.now() - t0;

    is(returned < EMIT_MS, true,
        `awaitEmit:false returns in ${returned}ms, without waiting ${EMIT_MS}ms for emission`);
    is(order.status, 'paid', 'the money is recorded before emission either way');
    is(emitStarted > 0, true, 'emission still STARTS — it is deferred, not skipped');
    is(emitFinished, 0, '…and had not finished when the cashier got their receipt');

    // The promise is reachable, so the caller can sequence a refresh after it.
    is(typeof order.emitting.then, 'function', 'the emission promise is exposed as `emitting`');
    // …and can never be mistaken for data.
    is(Object.keys(order).includes('emitting'), false,
        'it is NON-ENUMERABLE — a promise must never reach Firestore or a spread');
    is(JSON.stringify(order).includes('emitting'), false, '…nor JSON');

    await order.emitting;
    is(emitFinished > 0, true, 'awaiting it still resolves when emission completes');

    // ── The till is actually wired this way ────────────────────────────────
    // The DAL supporting it means nothing if the payment handler still waits.
    // The whole submit handler, not a fixed character window: the call and the
    // refresh sit ~50 lines apart with the receipt and toast between them, and
    // a short slice would pass or fail on comment length rather than on code.
    const payStart = TILL.indexOf("ds.recordPosPayment(state.uid, state.orderId");
    const payBlock = TILL.slice(payStart, TILL.indexOf('} catch (err) {', payStart));
    is(/awaitEmit:\s*false/.test(payBlock), true, 'the till passes awaitEmit: false');
    is(/order\.emitting/.test(payBlock), true,
        'and awaits `order.emitting` before refreshing');
    // Order matters: the refresh must come AFTER the emission, or the overview
    // reads the sale as unposted and flashes a nudge at a blameless cashier.
    is(payBlock.indexOf('order.emitting') < payBlock.indexOf('refresh({ keepOrder: true })'), true,
        'the emission is awaited BEFORE the refresh, not after');

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\npos payment latency: clean\n');
    process.exit(failures ? 1 : 0);
})().catch((err) => {
    console.error('\n✗ pos-payment-latency check threw:', err);
    process.exit(1);
});
