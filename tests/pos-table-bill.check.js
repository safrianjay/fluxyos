'use strict';

// =============================================================================
// One tender across several tickets adds up — in three different directions.
//
// WHY THIS IS PURE AND NOT A BROWSER TEST. `payPosTableBill` settles N orders in
// one Firestore transaction, and the thing that can go wrong is arithmetic, not
// rendering. Every failure mode below produces documents that are individually
// consistent and a drawer that is quietly wrong:
//
//   Σ amount           must equal the BILL      — this is what revenue absorbs
//   Σ amount_received  must equal the TENDER    — what crossed the counter
//   Σ change_given     must equal the CHANGE    — what went back
//
// `getPosShiftTally` sums the last two off the payments, so putting the whole
// tender on every ticket, or the change on more than one, makes the close read
// over or short by exactly the difference. That is the same defect `amount` vs
// `amount_received` fixed for a single order on 2026-09-01 — one level up, and
// invisible for the same reason: nothing errors.
//
// The method is lifted out of the module and driven against a fake transaction,
// so this measures the real code with no Firestore, no emulator and no browser.
//
// Run: node tests/pos-table-bill.check.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'assets/js/pos-service.js'), 'utf8');

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (actual, expected, label) => {
    if (actual === expected) ok(label);
    else fail(`${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

/**
 * Lift a SYNC helper out of the module, so the check drives the real predicate.
 *
 * Hand-writing `_posSettled` into the stub would let the two drift, and the
 * thing that would drift is "has this customer paid" — which now decides
 * whether the kitchen keeps its ticket, whether the sale reaches the ledger and
 * whether the drawer count includes it.
 */
function syncMethodUnder(name) {
    const start = SRC.indexOf(`    ${name}(`);
    if (start === -1) throw new Error(`${name} not found in pos-service.js`);
    const end = SRC.indexOf('\n    },\n', start);
    if (end === -1) throw new Error(`could not find the end of ${name}`);
    // eslint-disable-next-line no-new-func
    return new Function(`return ({ ${SRC.slice(start, end + 6)} });`)()[name];
}

/** Lift one method out of the module and bind the module-level names it reads. */
function methodUnder(name, env) {
    const start = SRC.indexOf(`    async ${name}(`);
    if (start === -1) throw new Error(`${name} not found in pos-service.js`);
    const end = SRC.indexOf('\n    },\n', start);
    if (end === -1) throw new Error(`could not find the end of ${name}`);
    const body = SRC.slice(start, end + 6);
    const keys = Object.keys(env);
    // eslint-disable-next-line no-new-func
    return new Function(...keys, `return ({ ${body} });`)(...keys.map((k) => env[k]))[name];
}

// ── The fake world ──────────────────────────────────────────────────────────
const SERVER_TS = { __server: true };
let store = {};
let writes = [];
let readsClosed = false;          // set when the first write lands

function resetWorld() { store = {}; writes = []; readsClosed = false; }

const env = {
    POS_PAYMENT_METHODS: [
        { id: 'cash', tender: 'cash', settlement: 'cash' },
        { id: 'qris', tender: 'external', settlement: 'clearing' }
    ],
    Timestamp: { fromDate: (d) => ({ __ts: d.getTime() }) },
    serverTimestamp: () => SERVER_TS,
    doc: (db, p) => ({ path: p, id: p.split('/').pop() }),
    posToMs: (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : (v && v.__ts) || null),
    runTransaction: async (db, fn) => fn({
        get: async (ref) => {
            // THE TRANSACTION CONTRACT: every read before any write. Firestore
            // throws on a read after a write, and a fake that allows it would
            // let the real thing ship broken.
            if (readsClosed) throw new Error('read after write inside the transaction');
            const data = store[ref.id];
            return { id: ref.id, exists: () => !!data, data: () => data };
        },
        update: (ref, patch) => { readsClosed = true; writes.push({ id: ref.id, patch }); }
    })
};

const payBill = methodUnder('payPosTableBill', env);

/** A host carrying only what the method actually reaches for. */
const host = {
    db: {},
    actorUid: 'u_cashier',
    _scope: () => 'workspaces/w1',
    _nullableString: (v, n) => (v ? String(v).slice(0, n) : null),
    _posTenderFor: (m) => (m === 'cash' ? 'cash' : 'external'),
    _posSettled: syncMethodUnder('_posSettled'),
    _posCoveredLineIds: syncMethodUnder('_posCoveredLineIds'),
    _pricing: () => require('../assets/js/pos-pricing.js'),
    _posKitchenPending: syncMethodUnder('_posKitchenPending'),
    _posStatusAfterPayment: syncMethodUnder('_posStatusAfterPayment'),
    _posTotals: (o) => ({
        subtotal: o.subtotal || 0,
        discount_total: 0,
        service_charge_amount: 0,
        tax_amount: 0,
        total_amount: Number(o.total_amount) || 0,
        paid_amount: (o.payments || [])
            .filter((p) => p.status === 'settled')
            .reduce((t, p) => t + (Number(p.amount) || 0), 0)
    }),
    _emitPosSale: async () => {}
};
// The F&B ladder the till hands the DAL. A retail counter passes none, which is
// what makes a pay-first sale close out on payment.
const FNB = { open: 'sent', submitted: 'sent', sent: 'ready', ready: 'served', served: 'awaiting_payment' };
const pay = (ids, opts) => payBill.call(host, 'u1', ids, { ladder: FNB, ...opts });

const ticket = (id, over = {}) => ({
    id,
    order_number: id.toUpperCase(),
    status: 'served',
    table_id: 't6',
    table_label: '6',
    dimension_id: 'd1',
    lines: [{ line_id: 'l1', item_name: 'Nasi Goreng', quantity: 1, gross_amount: over.total_amount || 50000 }],
    subtotal: over.total_amount || 50000,
    total_amount: 50000,
    paid_amount: 0,
    payments: [],
    version: 3,
    opened_at: { __ts: 1000 },
    ...over
});

const seed = (...rows) => { resetWorld(); rows.forEach((r) => { store[r.id] = r; }); };
const paymentsOn = (id) => (writes.find((w) => w.id === id) || { patch: {} }).patch.payments || [];
const lastPayment = (id) => paymentsOn(id).slice(-1)[0] || {};
const sumOver = (field) => writes.reduce((t, w) =>
    t + (w.patch.payments || []).slice(-1).reduce((x, p) => x + (Number(p[field]) || 0), 0), 0);

(async () => {
    console.log('\npos table bill\n');

    // ── 1. The three sums ───────────────────────────────────────────────────
    seed(ticket('o1', { total_amount: 50000, opened_at: { __ts: 1000 } }),
         ticket('o2', { total_amount: 30000, opened_at: { __ts: 2000 } }));
    let res = await pay(['o1', 'o2'], { method: 'cash', amountReceived: 100000 });

    is(res.billDue, 80000, 'the bill is the sum of what the tickets still owe');
    is(res.received, 100000, 'the tender is what the cashier entered');
    is(res.change, 20000, 'change is tender minus bill');
    is(sumOver('amount'), 80000, 'Σ amount equals the BILL — what revenue absorbs');
    is(sumOver('amount_received'), 100000, 'Σ amount_received equals the TENDER');
    is(sumOver('change_given'), 20000, 'Σ change_given equals the CHANGE');

    // ── 2. The change is ONE handful of notes ───────────────────────────────
    // Split across tickets it would still sum correctly and still be wrong: no
    // cashier hands back two piles, and a per-ticket change figure on a receipt
    // is a number the customer cannot check against anything.
    is(lastPayment('o1').change_given, 0, 'the earlier ticket gives no change');
    is(lastPayment('o2').change_given, 20000, 'the change rides on the LAST ticket, whole');
    is(lastPayment('o1').amount, 50000, 'each ticket absorbs its own total');
    is(lastPayment('o2').amount, 30000, '…and only its own');

    // ── 3. Both tickets settle, and the board's clock is stamped ────────────
    is(writes.length, 2, 'both tickets are written');
    is(writes.every((w) => w.patch.status === 'paid'), true, 'every ticket on the bill is paid');
    is(writes.every((w) => w.patch.version === 4), true, 'version advances by exactly one — the rules require it');
    is(writes.every((w) => w.patch.status_changed_at === SERVER_TS), true,
        'a real transition stamps status_changed_at, which is the board’s clock');

    // ── 4. One bill id ties them together ───────────────────────────────────
    // It is what lets a reprint weeks later rebuild the same combined receipt
    // instead of printing one slip per ticket to a customer who paid once.
    const ids = new Set(writes.map((w) => w.patch.payments.slice(-1)[0].bill_id));
    is(ids.size, 1, 'every payment carries the SAME bill_id');
    is([...ids][0] === undefined, false, '…and it is actually set');

    // ⚠️ AND THE IDS BESIDE IT. Firestore cannot query inside an array of maps,
    // so `bill_id` on its own is a grouping key nothing can group by — a reprint
    // would hand the customer one ticket's slip for a bill they paid in full.
    is(JSON.stringify(lastPayment('o1').bill_orders), JSON.stringify(['o1', 'o2']),
        'the payment records WHICH tickets were paid together');
    is(JSON.stringify(lastPayment('o2').bill_orders), JSON.stringify(['o1', 'o2']),
        '…on every ticket, so a reprint works from whichever one is tapped');
    is(JSON.stringify(lastPayment('o1').bill_orders), JSON.stringify(['o1', 'o2']),
        '…in receipt order, oldest first');

    // ── 5. Order does not matter to the caller ──────────────────────────────
    // The tickets are sorted oldest-first inside, so the change lands in the
    // same place however the board happened to hand them over.
    seed(ticket('o1', { total_amount: 50000, opened_at: { __ts: 1000 } }),
         ticket('o2', { total_amount: 30000, opened_at: { __ts: 2000 } }));
    await pay(['o2', 'o1'], { method: 'cash', amountReceived: 100000 });
    is(lastPayment('o2').change_given, 20000, 'a reversed caller list still puts change on the newest ticket');

    // ── 6. A part-paid ticket is billed for the REMAINDER ───────────────────
    seed(ticket('o1', {
        total_amount: 50000, opened_at: { __ts: 1000 },
        payments: [{ payment_id: 'old', status: 'settled', amount: 20000 }]
    }), ticket('o2', { total_amount: 30000, opened_at: { __ts: 2000 } }));
    res = await pay(['o1', 'o2'], { method: 'cash', amountReceived: 60000 });
    is(res.billDue, 60000, 'a ticket already part-paid adds only what is left');
    is(lastPayment('o1').amount, 30000, '…and takes only its remainder');

    // ── 7. Splitting is the same call with a shorter list ───────────────────
    seed(ticket('o1', { total_amount: 50000, opened_at: { __ts: 1000 } }),
         ticket('o2', { total_amount: 30000, opened_at: { __ts: 2000 } }));
    res = await pay(['o1'], { method: 'cash', amountReceived: 50000 });
    is(res.billDue, 50000, 'a split bill charges only the tickets chosen');
    is(writes.length, 1, '…and writes only those');
    is(store.o2.status, 'served', 'the ticket left out is untouched and still owed');
    is(JSON.stringify(lastPayment('o1').bill_orders), JSON.stringify(['o1']),
        'a one-ticket bill records only itself — the reprint must not go looking for a sibling');

    // ── 7b. PAYING DOES NOT COOK THE FOOD ───────────────────────────────────
    //
    // ⚠️ Order status and payment status are two different things, and this is
    // the assertion that says so. Settling a merged bill used to write 'paid'
    // onto every ticket on it — so #002, still in the pan, went terminal the
    // moment the customer paid: off the kitchen tab, and reading as done to the
    // cook who still had to make it.
    seed(ticket('o1', { total_amount: 50000, status: 'served', opened_at: { __ts: 1000 } }),
         ticket('o2', { total_amount: 30000, status: 'sent', opened_at: { __ts: 2000 } }));
    await pay(['o1', 'o2'], { method: 'cash', amountReceived: 80000 });

    const patchOf = (id) => (writes.find((w) => w.id === id) || {}).patch || {};
    is(patchOf('o1').status, 'paid', 'a ticket the kitchen has finished closes out');
    is(patchOf('o2').status, 'sent', 'a ticket still in the kitchen KEEPS ITS OWN STATUS');
    is(patchOf('o2').paid_at !== null, true, '…and is still recorded as paid');
    is(patchOf('o2').paid_amount, 30000, '…for its own full amount');
    // The board's clock must not restart on a ticket that did not move.
    is('status_changed_at' in patchOf('o2'), false,
        'a ticket that did not change status does not restart the kitchen’s timer');
    is(patchOf('o1').status_changed_at === SERVER_TS, true,
        '…while the one that DID move is stamped');

    // Same rule on a part payment, which used to force `awaiting_payment` onto a
    // ticket that was still frying.
    seed(ticket('o1', { total_amount: 50000, status: 'ready', opened_at: { __ts: 1000 } }));
    await pay(['o1'], { method: 'cash', amountReceived: 50000 });
    is(patchOf('o1').status, 'ready', 'a READY ticket paid for is still ready to serve');

    // ⚠️ AND A COUNTER WITH NO KITCHEN CLOSES OUT ON PAYMENT. The first cut of
    // this rule hardcoded the F&B statuses, so every pay-first RETAIL sale — an
    // order that lives at `open` and has no ladder at all — sat `open` forever
    // with its receipt printed and the sale never closed.
    seed(ticket('o1', { total_amount: 50000, status: 'open', opened_at: { __ts: 1000 } }));
    await payBill.call(host, 'u1', ['o1'], { method: 'cash', amountReceived: 50000 });
    is(patchOf('o1').status, 'paid', 'a retail sale with no kitchen ladder closes out');

    // …and the same order under an F&B ladder does NOT, because `open` there
    // means the kitchen has not been given it yet.
    seed(ticket('o1', { total_amount: 50000, status: 'open', opened_at: { __ts: 1000 } }));
    await pay(['o1'], { method: 'cash', amountReceived: 50000 });
    is(patchOf('o1').status, 'open', 'the same sale under a kitchen ladder keeps its place in it');

    // ── 7c. SPLIT BY ITEM ───────────────────────────────────────────────────
    //
    // "I'll pay for my dish." The selection is lines rather than tickets, and
    // each payer owes their share of that ticket's service charge and tax — a
    // split that charges the menu price and drops the rest is a bill that does
    // not foot and a restaurant that under-collects.
    //
    // ⚠️ THE INVARIANT IS EXACTNESS. Split a ticket three ways and the three
    // amounts must total it to the rupiah: short by one and the last payer
    // cannot close the ticket, over by one and they are charged for a rupiah
    // nobody owes — either way the order sits unsettled with the table still
    // reading occupied.
    const dish = (id, gross, extra) => ({
        line_id: id, item_id: `i-${id}`, item_name: `Dish ${id}`,
        quantity: 1, unit_price: gross, gross_amount: gross, ...(extra || {})
    });
    // 200.000 of food + 10.000 service + 22.000 tax — Jay's own receipt.
    const splitTicket = (over) => ticket('o1', {
        total_amount: 232000, subtotal: 200000, status: 'served',
        lines: [dish('a', 125000), dish('b', 10000), dish('c', 65000)],
        ...(over || {})
    });
    const payLines = (sel, opts) => payBill.call(host, 'u1', null,
        { ladder: FNB, lines: sel, ...opts });

    seed(splitTicket());
    res = await payLines([{ order_id: 'o1', line_ids: ['a'] }],
        { method: 'cash', amountReceived: 145000 });
    is(res.billDue, 145000, 'one dish carries its share of the service and tax, not the menu price');
    is(lastPayment('o1').amount, 145000, '…and that is what the payment records');
    is(JSON.stringify(lastPayment('o1').line_ids), JSON.stringify(['a']),
        'the payment names the items it settled');
    // Served and only part paid IS awaiting payment — the kitchen is finished
    // and the table still owes for the rest.
    is(patchOf('o1').status, 'awaiting_payment',
        'a served ticket with items still unpaid is awaiting payment');

    // …but a ticket the KITCHEN still has keeps its rung, exactly as a whole
    // payment leaves it. Somebody paying for their starter must not take the
    // main course off the cook's screen.
    seed(splitTicket({ status: 'sent' }));
    await payLines([{ order_id: 'o1', line_ids: ['a'] }], { method: 'cash' });
    is(patchOf('o1').status, 'sent', 'splitting a ticket does not move it off the kitchen screen');

    // Three payers, one ticket, in sequence — the sums have to land EXACTLY.
    // Done as a real sequence rather than a helper, so each step reads.
    let covered = [];
    let paidSoFar = 0;
    const takenPayments = [];
    for (const pick of [['a'], ['b'], ['c']]) {
        seed(splitTicket({ paid_amount: paidSoFar, payments: takenPayments.slice() }));
        // eslint-disable-next-line no-await-in-loop
        const r = await payLines([{ order_id: 'o1', line_ids: pick }], { method: 'cash' });
        takenPayments.push({
            payment_id: `t${covered.length}`, status: 'settled',
            amount: r.billDue, line_ids: pick
        });
        covered = covered.concat(pick);
        paidSoFar += r.billDue;
    }
    is(paidSoFar, 232000, 'THREE SPLITS TOTAL THE TICKET, to the rupiah');
    is(takenPayments[2].amount, 232000 - takenPayments[0].amount - takenPayments[1].amount,
        'the last payer takes the exact remainder, never a rounded share');

    // The same three in a different order still total the ticket — rounding
    // must not depend on who pays first.
    covered = []; paidSoFar = 0; takenPayments.length = 0;
    for (const pick of [['c'], ['a'], ['b']]) {
        seed(splitTicket({ paid_amount: paidSoFar, payments: takenPayments.slice() }));
        // eslint-disable-next-line no-await-in-loop
        const r = await payLines([{ order_id: 'o1', line_ids: pick }], { method: 'cash' });
        takenPayments.push({ payment_id: `u${covered.length}`, status: 'settled', amount: r.billDue, line_ids: pick });
        covered = covered.concat(pick);
        paidSoFar += r.billDue;
    }
    is(paidSoFar, 232000, '…and so do the same three in a different order');

    // The final split SETTLES the ticket, which is what closes the table out.
    is(patchOf('o1').status, 'paid', 'the last item paid for closes the ticket');
    is(patchOf('o1').paid_at !== null, true, '…and stamps it paid');

    // A line paid for twice is money collected twice, and both payments look
    // right. This is the guard that stops it.
    seed(splitTicket({
        paid_amount: 145000,
        payments: [{ payment_id: 'x', status: 'settled', amount: 145000, line_ids: ['a'] }]
    }));
    try {
        await payLines([{ order_id: 'o1', line_ids: ['a'] }], { method: 'cash' });
        fail('a dish already paid for was charged again');
    } catch (e) {
        is(/already paid for one of those items/i.test(e.message), true,
            'an item somebody has already paid for cannot be charged again');
    }

    // A whole-ticket part payment says nothing about WHICH items it covered, so
    // a split after one would charge for them again.
    seed(splitTicket({
        paid_amount: 50000,
        payments: [{ payment_id: 'y', status: 'settled', amount: 50000 }]
    }));
    try {
        await payLines([{ order_id: 'o1', line_ids: ['a'] }], { method: 'cash' });
        fail('a split was allowed on top of a blind part payment');
    } catch (e) {
        is(/against the whole ticket/i.test(e.message), true,
            'a split is refused on a ticket already part-paid without item detail');
    }

    seed(splitTicket());
    try {
        await payLines([{ order_id: 'o1', line_ids: ['nope'] }], { method: 'cash' });
        fail('an item that is not on the ticket was billed');
    } catch (e) {
        is(/no such item/i.test(e.message), true, 'an item that is not on the ticket is refused');
    }

    // ── 8. The refusals ─────────────────────────────────────────────────────
    const refuses = async (label, ids2, opts, match) => {
        try { await pay(ids2, opts); fail(`${label} — it was ALLOWED`); }
        catch (e) {
            if (match.test(e.message)) ok(label);
            else fail(`${label}\n      wrong reason: ${e.message}`);
        }
    };

    seed(ticket('o1', { total_amount: 50000 }), ticket('o2', { total_amount: 30000, opened_at: { __ts: 2000 } }));
    await refuses('a tender below the bill is refused', ['o1', 'o2'],
        { method: 'cash', amountReceived: 70000 }, /less than the bill/i);

    seed(ticket('o1'), ticket('o2', { opened_at: { __ts: 2000 } }));
    await refuses('no change on a card — nobody counts notes out of a terminal', ['o1', 'o2'],
        { method: 'qris', amountReceived: 200000 }, /change can only be given on a cash/i);

    // ⚠️ THE ONE THAT PROTECTS SOMEBODY ELSE'S MONEY. Without it a mis-tap
    // settles another table's food against this customer's cash, and both
    // orders look individually correct afterwards.
    seed(ticket('o1'), ticket('o2', { table_id: 't7', table_label: '7', opened_at: { __ts: 2000 } }));
    await refuses('two different tables cannot be settled as one bill', ['o1', 'o2'],
        { method: 'cash', amountReceived: 100000 }, /same table/i);

    seed(ticket('o1', { table_id: null, table_label: null }),
         ticket('o2', { table_id: null, table_label: null, opened_at: { __ts: 2000 } }));
    await refuses('takeaway has no table, so two bags are not one bill', ['o1', 'o2'],
        { method: 'cash', amountReceived: 100000 }, /same table/i);

    seed(ticket('o1'), ticket('o2', { dimension_id: 'd2', opened_at: { __ts: 2000 } }));
    await refuses('two outlets cannot be settled as one bill', ['o1', 'o2'],
        { method: 'cash', amountReceived: 100000 }, /same outlet/i);

    seed(ticket('o1'), ticket('o2', { status: 'void', opened_at: { __ts: 2000 } }));
    await refuses('a voided ticket cannot be paid', ['o1', 'o2'],
        { method: 'cash', amountReceived: 100000 }, /voided/i);

    seed(ticket('o1'), ticket('o2', {
        status: 'paid', opened_at: { __ts: 2000 }, paid_amount: 50000,
        payments: [{ payment_id: 'p', status: 'settled', amount: 50000 }]
    }));
    await refuses('an already-paid ticket cannot be charged twice', ['o1', 'o2'],
        { method: 'cash', amountReceived: 100000 }, /already paid/i);

    seed(ticket('o1'));
    await refuses('a ticket that vanished mid-payment stops the whole bill', ['o1', 'gone'],
        { method: 'cash', amountReceived: 100000 }, /no longer exists/i);

    seed(ticket('o1', { lines: [] }));
    await refuses('an empty ticket has nothing to pay for', ['o1'],
        { method: 'cash', amountReceived: 50000 }, /nothing on it/i);

    resetWorld();
    await refuses('an empty selection is refused', [], { method: 'cash' }, /at least one/i);

    seed(ticket('o1'));
    await refuses('an unknown payment method is refused', ['o1'],
        { method: 'crypto', amountReceived: 50000 }, /how the customer paid/i);

    // ── 9. Nothing is written when anything is refused ──────────────────────
    // The whole reason this is ONE transaction: a cashier must never be holding
    // cash against a bill that is half settled.
    is(writes.length, 0, 'a refused bill writes nothing at all');

    // ── 10. Exact money still works ─────────────────────────────────────────
    seed(ticket('o1', { total_amount: 50000 }), ticket('o2', { total_amount: 30000, opened_at: { __ts: 2000 } }));
    res = await pay(['o1', 'o2'], { method: 'cash' });
    is(res.received, 80000, 'omitting the tender means exact money');
    is(res.change, 0, '…and no change');
    is(sumOver('amount_received'), 80000, 'Σ amount_received still equals the tender');

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\npos table bill: clean\n');
    process.exit(failures ? 1 : 0);
})();
