// =============================================================================
// FluxyOS — Till sales that never reached the ledger (read-only)
//
// WHY THIS EXISTS.
//
// Between 2026-08-30 and 2026-08-31 every POS write carrying the settlement
// split was refused by firestore.rules: `_posSettlementAmounts` returned
// `{ cash, clearing }` and neither name is in wsValidTxCreate's `hasOnly`. The
// order was still marked PAID — the money was taken — and no revenue posted.
// Nothing went red: the sale emitter catches the denial and defers to a retry
// sweep, and the retry rebuilt the same permanently-invalid payload every time.
//
// The client-side fix stops new losses and the in-app sweep now drains a
// backlog automatically. This script answers the question the app cannot:
// **across every workspace, how much revenue is still missing, and whose?**
//
// A till order counts as unposted when `status == 'paid'` and it carries no
// `transaction_id`. That field is the idempotency key and is stamped in the SAME
// batch as the transaction it points at, so its absence is not a race — it means
// the transaction was never written.
//
// Refunded orders are reported separately. A refund reverses a sale that DID
// post, so an unposted refund is a different repair from an unposted sale and
// mixing them into one total would overstate the missing revenue.
//
// NEVER writes. There is no --commit flag: recovery runs through the app, where
// posting goes through the one journal engine rather than a second copy of it in
// a script. PRODUCT_STRATEGY §6 — no module keeps its own books, and that
// includes this one.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/pos-unposted-report.js
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/pos-unposted-report.js --workspace <wsId>
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/pos-unposted-report.js --since 2026-08-29
// =============================================================================

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const ONLY_WS = flag('workspace', null);
const SINCE = flag('since', null);
const sinceMs = SINCE ? Date.parse(`${SINCE}T00:00:00`) : null;
if (SINCE && !Number.isFinite(sinceMs)) {
    console.error(`--since expects YYYY-MM-DD, got "${SINCE}"`);
    process.exit(1);
}

if (admin.apps.length === 0) {
    admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {});
}
const db = admin.firestore();

const rp = (n) => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const day = (ts) => {
    const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
    return d ? d.toISOString().slice(0, 10) : '?';
};

async function scanWorkspace(wsId, name) {
    const snap = await db.collection('workspaces').doc(wsId).collection('pos_orders').get();
    if (snap.empty) return null;

    const unpostedSales = [];
    const unpostedRefunds = [];
    let paid = 0;

    snap.forEach((d) => {
        const o = { id: d.id, ...d.data() };
        if (o.status !== 'paid') return;
        const when = o.paid_at || o.opened_at || o.created_at;
        if (sinceMs) {
            const t = when && typeof when.toDate === 'function' ? when.toDate().getTime() : 0;
            if (t < sinceMs) return;
        }
        paid += 1;

        if (!o.transaction_id) {
            unpostedSales.push({
                number: o.order_number || o.id,
                amount: Number(o.total_amount) || 0,
                when: day(when),
                outlet: o.dimension_id || '—'
            });
        }
        // A refund whose reversing transaction never landed. Separate repair,
        // separate total — this is money the books still show as earned.
        if (o.refund_reason && !o.refund_transaction_id) {
            unpostedRefunds.push({
                number: o.order_number || o.id,
                amount: Number(o.total_amount) || 0,
                when: day(o.refunded_at || when)
            });
        }
    });

    return {
        wsId,
        name: name || '?',
        paid,
        unposted: unpostedSales.length,
        value: unpostedSales.reduce((s, r) => s + r.amount, 0),
        unpostedRefunds: unpostedRefunds.length,
        refundValue: unpostedRefunds.reduce((s, r) => s + r.amount, 0),
        sales: unpostedSales.sort((a, b) => (a.when < b.when ? -1 : 1)),
        refunds: unpostedRefunds
    };
}

async function main() {
    const wsIds = ONLY_WS
        ? [ONLY_WS]
        : (await db.collection('workspaces').get()).docs.map((d) => d.id);

    const rows = [];
    for (const id of wsIds) {
        const doc = await db.collection('workspaces').doc(id).get();
        const r = await scanWorkspace(id, doc.data()?.name);
        if (r && r.paid) rows.push(r);
    }
    rows.sort((a, b) => b.value - a.value);

    const scope = SINCE ? ` (paid on or after ${SINCE})` : '';
    console.log(`\ntill sales that never reached the ledger${scope}\n`);
    if (!rows.length) {
        console.log('  no workspace has a paid till order at all.\n');
        return;
    }

    console.log('workspace                     name                        paid  unposted   missing revenue');
    rows.forEach((r) => console.log(
        `${r.wsId}  ${String(r.name).slice(0, 26).padEnd(26)} ${String(r.paid).padStart(5)} `
        + `${String(r.unposted).padStart(9)}   ${r.unposted ? rp(r.value) : '—'}`
    ));

    const T = rows.reduce((a, r) => ({
        paid: a.paid + r.paid,
        un: a.un + r.unposted,
        val: a.val + r.value,
        rf: a.rf + r.unpostedRefunds,
        rfv: a.rfv + r.refundValue
    }), { paid: 0, un: 0, val: 0, rf: 0, rfv: 0 });

    console.log(`\n  ${T.paid} paid order(s) across ${rows.length} workspace(s); `
        + `${T.un} never posted, worth ${rp(T.val)}.`);
    if (T.rf) {
        console.log(`  ${T.rf} refund(s) worth ${rp(T.rfv)} were recorded on the order but never `
            + 'reversed in the ledger — the books still show that revenue as earned.');
    }

    // The detail, per affected workspace. A total tells you there is a problem;
    // the order numbers are what someone can actually check against a till.
    rows.filter((r) => r.unposted || r.unpostedRefunds).forEach((r) => {
        console.log(`\n  ${r.name} (${r.wsId})`);
        r.sales.slice(0, 40).forEach((o) => console.log(
            `    unposted sale    ${String(o.number).padEnd(18)} ${o.when}  ${rp(o.amount).padStart(14)}  outlet ${o.outlet}`
        ));
        if (r.sales.length > 40) console.log(`    …and ${r.sales.length - 40} more`);
        r.refunds.slice(0, 20).forEach((o) => console.log(
            `    unposted refund  ${String(o.number).padEnd(18)} ${o.when}  ${rp(o.amount).padStart(14)}`
        ));
    });

    if (T.un || T.rf) {
        console.log('\n  To recover: open pos.fluxyos.com as a finance-capable user (owner, admin,');
        console.log('  finance or accountant) on the affected OUTLET. The sweep now runs by itself');
        console.log('  on load and posts the backlog; the bell also keeps a manual "Post now".');
        console.log('  A cashier session cannot post — it may not write journals — so signing in');
        console.log('  as the till user will report the backlog and never clear it.');
        console.log('\n  Then re-run this script: it must come back clean.\n');
    } else {
        console.log('\n  clean — every paid till order points at a ledger transaction.\n');
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
