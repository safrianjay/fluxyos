// =============================================================================
// FluxyOS — Deliveries that were never matched to their invoice (read-only)
//
// WHY THIS EXISTS.
//
// `selectRule` has always routed a bill carrying `goods_receipt_id` to
// BILL-GRNI — Dr 2050 Goods Received Not Invoiced / Cr 2000 A/P, settling the
// liability the delivery raised. Nothing in the product ever SET that field, so
// the branch was unreachable and every bill for received goods took BILL-ACCRUE
// instead: Dr expense / Cr A/P.
//
// The consequence is that the same money is expensed twice —
//
//     goods arrive   Dr 1200 Inventory   / Cr 2050 GRNI
//     bill posts     Dr <expense>        / Cr 2000 A/P     <- should have been Dr 2050
//     stock sells    Dr 5100 COGS        / Cr 1200
//
// — once in OpEx when the bill is paid (paying a bill writes a `type: 'expense'`
// transaction, and the Dashboard's OpEx sums exactly those), and again as COGS
// when the stock leaves. Meanwhile 2050 can only grow, which is the signal
// `docs/data-model/stock.md` §1 says should trend to zero.
//
// The product side is fixed going forward: the Add Bill drawer now offers the
// open deliveries and the link routes BILL-GRNI. This script answers what the
// app cannot — **which historical deliveries were never invoiced, what that is
// worth, and which existing bill each one most likely belongs to.**
//
// ⚠️ IT NEVER WRITES, AND THERE IS DELIBERATELY NO --commit.
//
// Back-filling is not a matter of setting a field. Those bills ALREADY POSTED
// their expense, and journals are immutable — corrected by reversal, never by
// edit. Stamping `goods_receipt_id` onto them now would change nothing in the
// ledger and would hide the problem by making the receipts look matched. The
// repair is a reclassification journal per matched pair:
//
//     Dr 2050 GRNI / Cr <the expense account the bill debited>
//
// which removes the double-counted cost and clears the liability. That is a real
// accounting act: it needs a human to confirm each pair, it must post into an
// OPEN period (prior-period reclassification is normally booked in the current
// one), and it belongs in the app's journal engine rather than a second copy of
// it in a script — PRODUCT_STRATEGY §6, no module keeps its own books.
//
// So this produces the worksheet. A person decides.
//
// HOW CANDIDATES ARE RANKED. Same-vendor first, then amount, then proximity in
// time. An exact amount match from the same vendor within the window is called
// `confident`; everything else is `review`. Nothing is ever called certain,
// because a supplier who delivers weekly at the same price produces several
// indistinguishable candidates and picking one for you would be a guess wearing
// a number.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/grni-match-report.js
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/grni-match-report.js --workspace <wsId>
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/grni-match-report.js --workspace <wsId> --days 45
//   ... --csv > worksheet.csv
// =============================================================================

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const ONLY_WS = flag('workspace');
// How far either side of a delivery to look for its invoice. Suppliers routinely
// invoice a fortnight later; 30 days is generous without pairing a March
// delivery with a June bill.
const WINDOW_DAYS = Number(flag('days', 30)) || 30;
const AS_CSV = args.includes('--csv');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key first.');
    process.exit(1);
}
if (!admin.apps.length) admin.initializeApp({ projectId: 'fluxyos' });
const db = admin.firestore();

const toMs = (v) => {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
};
const rp = (n) => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');
// Vendor names are typed by hand and arrive as "PT Sinar", "pt sinar" and
// "PT  Sinar". Matching on the raw string would report every one of those as a
// different supplier and find no candidates at all.
const vkey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function auditWorkspace(wsId) {
    const base = `workspaces/${wsId}`;
    const [receiptSnap, billSnap] = await Promise.all([
        db.collection(`${base}/goods_receipts`).get(),
        db.collection(`${base}/bills`).get()
    ]);
    const receipts = receiptSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!receipts.length) return null;

    const bills = billSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // A bill already pointing at a delivery is settled business. A bill pointing
    // at a DIFFERENT delivery must not be offered again, or one invoice would be
    // proposed as the answer to two receipts.
    const takenBillIds = new Set(receipts.map((r) => r.bill_id).filter(Boolean));
    const freeBills = bills.filter((b) => !b.goods_receipt_id && !takenBillIds.has(b.id));

    const open = receipts.filter((r) => r.status === 'received' && !r.bill_id);
    const exposure = open.reduce((s, r) => s + Math.round(Number(r.total_amount) || 0), 0);

    const rows = open.map((r) => {
        const rMs = toMs(r.timestamp);
        const total = Math.round(Number(r.total_amount) || 0);
        const windowMs = WINDOW_DAYS * 86400000;

        const candidates = freeBills
            .map((b) => {
                const bMs = toMs(b.due_date) || toMs(b.timestamp);
                const amt = Math.round(Number(b.amount) || 0);
                const sameVendor = vkey(b.vendor_name) && vkey(b.vendor_name) === vkey(r.vendor_name);
                const gap = (rMs != null && bMs != null) ? Math.abs(bMs - rMs) : Infinity;
                if (gap > windowMs) return null;
                // Scored, not filtered, so a near-miss on amount from the right
                // vendor still surfaces — that is a price variance, which is a
                // real thing and exactly what GRNI is designed to hold.
                let score = 0;
                if (sameVendor) score += 100;
                if (amt === total) score += 60;
                else if (total > 0 && Math.abs(amt - total) / total <= 0.05) score += 25;
                score += Math.max(0, 20 - Math.round(gap / 86400000));
                return { id: b.id, vendor: b.vendor_name || '—', amount: amt,
                         date: bMs, gapDays: Math.round(gap / 86400000), sameVendor, score };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);

        const best = candidates[0] || null;
        // "Confident" still means a person confirms it. It means the evidence is
        // unambiguous: one supplier, one exact amount, one candidate.
        const confident = !!best && best.sameVendor && best.amount === total
            && (candidates.length === 1 || candidates[1].score < best.score);

        return {
            receiptId: r.id, vendor: r.vendor_name || '—', reference: r.reference || '',
            date: rMs, total, candidates,
            verdict: !best ? 'no-candidate' : (confident ? 'confident' : 'review')
        };
    });

    return { wsId, receipts: receipts.length, open: open.length, exposure, bills: bills.length, rows };
}

(async () => {
    const wsIds = ONLY_WS
        ? [ONLY_WS]
        : (await db.collection('workspaces').get()).docs.map((d) => d.id);

    const results = [];
    for (const wsId of wsIds) {
        try {
            const r = await auditWorkspace(wsId);
            if (r) results.push(r);
        } catch (err) {
            console.error(`  ! ${wsId}: ${err.message}`);
        }
    }

    if (AS_CSV) {
        console.log('workspace,receipt_id,receipt_date,vendor,reference,receipt_total,verdict,candidate_bill_id,candidate_amount,candidate_gap_days');
        results.forEach((r) => r.rows.forEach((row) => {
            const c = row.candidates[0];
            console.log([r.wsId, row.receiptId, day(row.date), JSON.stringify(row.vendor),
                JSON.stringify(row.reference), row.total, row.verdict,
                c ? c.id : '', c ? c.amount : '', c ? c.gapDays : ''].join(','));
        }));
        process.exit(0);
    }

    console.log('\nDELIVERIES NEVER MATCHED TO AN INVOICE\n');
    if (!results.length) { console.log('  No workspace holds a goods receipt.\n'); process.exit(0); }

    let totalExposure = 0;
    for (const r of results) {
        totalExposure += r.exposure;
        console.log(`workspaces/${r.wsId}`);
        console.log(`  ${r.open} of ${r.receipts} deliveries unmatched · ${rp(r.exposure)} sitting in 2050 GRNI`);
        const by = (v) => r.rows.filter((x) => x.verdict === v).length;
        console.log(`  ${by('confident')} confident · ${by('review')} need review · ${by('no-candidate')} no candidate found`);
        r.rows.slice(0, 12).forEach((row) => {
            const c = row.candidates[0];
            console.log(`    ${day(row.date)}  ${String(row.vendor).slice(0, 26).padEnd(26)} ${rp(row.total).padStart(14)}  ${row.verdict}`);
            if (c) console.log(`        ↳ bill ${c.id}  ${rp(c.amount)}  ${c.gapDays}d apart${c.sameVendor ? '' : '  (different vendor)'}`);
        });
        if (r.rows.length > 12) console.log(`    … and ${r.rows.length - 12} more (use --csv for the full worksheet)`);
        console.log('');
    }

    console.log(`TOTAL EXPOSURE  ${rp(totalExposure)}\n`);
    console.log('This is read-only. Correcting a matched pair means posting a');
    console.log('reclassification journal — Dr 2050 GRNI / Cr the expense account the');
    console.log('bill debited — into an OPEN period, after a person confirms the pair.');
    console.log('Setting goods_receipt_id on those bills would change nothing in the');
    console.log('ledger: their journals already posted and journals are immutable.\n');
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
