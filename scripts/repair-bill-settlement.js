// =============================================================================
// FluxyOS — repair bills whose settlement was left behind by a voided payment
//
// The defect (fixed forward in 210929a): voiding a bill payment reversed its
// journal — putting the liability back in the general ledger — but left the bill
// reading `paid` with amount_paid untouched. The GL said the vendor was owed
// money while the bills list said the bill was settled.
//
// The forward fix is not retroactive, so any bill voided BEFORE it shipped is
// still wrong. This repairs those.
//
// THE LEDGER IS THE SOURCE OF TRUTH. The corrected figures are derived from the
// posted journals, never from the bill's own (wrong) fields:
//
//     outstanding = net A/P still carried by this bill's journals
//     amount_paid = face amount - outstanding
//
// Scope is deliberately narrow. A bill is only touched when its divergence is
// EXPLAINED by a voided or reversed payment. That excludes, for example, the
// foreign-currency bills that posted minor units as rupiah before the
// non-IDR guard existed — a different defect with a different repair, which this
// script must not silently "fix" into a wrong number.
//
// Dry-run by default. Nothing is written without --commit.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/repair-bill-settlement.js
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/repair-bill-settlement.js --workspace <wsId>
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/repair-bill-settlement.js --workspace <wsId> --commit
// =============================================================================

'use strict';

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const ONLY_WS = flag('workspace', null);
const COMMIT = args.includes('--commit');

// The runbook warns that the other scripts do not parse --dry-run, so
// `--dry-run --commit` silently writes. Refuse the contradiction outright rather
// than picking a winner.
if (COMMIT && args.includes('--dry-run')) {
    console.error('Refusing to run: --dry-run and --commit were both passed. Pick one.');
    process.exit(2);
}

if (admin.apps.length === 0) {
    admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {});
}
const db = admin.firestore();

const AP = '2000';
const toInt = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const rp = (n) => (n < 0 ? '-' : '') + 'Rp' + Math.abs(n).toLocaleString('id-ID');

// Mirrors expectedPayables() in netlify/functions/lib/ledger-assert.js — what the
// subledger currently believes this bill still owes.
function subledgerValue(bill) {
    if (bill.payment_status === 'paid' || bill.linked_transaction_id) return 0;
    if (bill.currency && bill.currency !== 'IDR') return 0;
    if (['excluded', 'reversed'].includes(bill.accounting_status)) return 0;
    const gross = bill.outstanding_amount != null
        ? Math.max(0, toInt(Math.abs(bill.outstanding_amount)))
        : Math.max(0, toInt(Math.abs(bill.amount)) - toInt(Math.abs(bill.amount_paid)));
    return Math.max(0, gross - Math.max(0, toInt(Math.abs(bill.withholding_amount || 0))));
}

async function scanWorkspace(wsId, wsName) {
    const base = db.collection('workspaces').doc(wsId);
    const [billsSnap, txSnap, jSnap] = await Promise.all([
        base.collection('bills').get(),
        base.collection('transactions').get(),
        base.collection('journals').get(),
    ]);
    if (billsSnap.empty) return [];

    const txById = {};
    txSnap.forEach((d) => { txById[d.id] = d.data() || {}; });

    // Net A/P per owning bill. A BILL-PAY journal is sourced from the PAYMENT
    // transaction, not the bill, so it is resolved back via linked_bill_id —
    // without that every paid bill looks like a mismatch.
    const glByBill = {};
    const voidedPayers = {};
    jSnap.forEach((d) => {
        const j = d.data() || {};
        if (j.status !== 'posted' && j.status !== 'reversal') return;
        let net = 0;
        (j.lines || []).forEach((l) => {
            if (String(l.account_code) !== AP) return;
            net += toInt(l.credit) - toInt(l.debit);
        });
        if (!net) return;
        const col = j.source && j.source.collection;
        const sid = j.source && j.source.id;
        let billId = null;
        if (col === 'bills') billId = sid;
        else if (col === 'transactions' && txById[sid]) billId = txById[sid].linked_bill_id || null;
        if (!billId) return;
        glByBill[billId] = (glByBill[billId] || 0) + net;
        if (col === 'transactions') {
            const tx = txById[sid];
            if (tx && (tx.is_voided || tx.accounting_status === 'reversed')) {
                // Keyed by transaction id: a voided payment contributes TWO
                // journals (the BILL-PAY and its reversal), and listing it twice
                // would read as double the money voided on the very output
                // someone approves a restatement from.
                const seen = (voidedPayers[billId] = voidedPayers[billId] || {});
                seen[sid] = toInt(Math.abs(tx.amount));
            }
        }
    });

    const out = [];
    billsSnap.forEach((d) => {
        const bill = d.data() || {};
        if (bill.currency && bill.currency !== 'IDR') return; // different defect class
        const glNet = glByBill[d.id] || 0;
        const sub = subledgerValue(bill);
        if (glNet === sub) return;
        // Only repair what a voided payment explains.
        const voided = Object.entries(voidedPayers[d.id] || {}).map(([id, amount]) => ({ id, amount }));
        if (!voided.length) return;

        const face = toInt(Math.abs(bill.amount));
        const outstanding = Math.max(0, glNet);
        const amountPaid = Math.max(0, face - outstanding);
        const status = amountPaid > 0 ? (outstanding > 0 ? 'partial' : 'paid') : 'unpaid';

        const patch = {
            amount_paid: amountPaid,
            outstanding_amount: outstanding,
            payment_status: status,
        };
        if (status !== 'paid' && bill.budget_impact_status === 'converted_to_actual') {
            patch.budget_impact_status = 'committed';
        }
        // Clear a deep link that points at a voided payment.
        if (bill.linked_transaction_id && voided.some((v) => v.id === bill.linked_transaction_id)) {
            patch.linked_transaction_id = null;
        }

        out.push({
            wsId, wsName, billId: d.id, vendor: bill.vendor_name || '(no vendor)',
            face, glNet, sub,
            before: {
                amount_paid: toInt(Math.abs(bill.amount_paid)),
                outstanding_amount: bill.outstanding_amount,
                payment_status: bill.payment_status,
                budget_impact_status: bill.budget_impact_status,
                linked_transaction_id: bill.linked_transaction_id || null,
            },
            after: patch,
            voided,
        });
    });
    return out;
}

(async () => {
    const wsSnap = ONLY_WS
        ? { docs: [await db.collection('workspaces').doc(ONLY_WS).get()] }
        : await db.collection('workspaces').get();

    const findings = [];
    for (const d of wsSnap.docs) {
        if (!d.exists) continue;
        findings.push(...await scanWorkspace(d.id, (d.data() || {}).name || ''));
    }

    if (!findings.length) {
        console.log('No bill carries a settlement that a voided payment left behind. Nothing to repair.');
        process.exit(0);
    }

    console.log(`${COMMIT ? 'REPAIRING' : 'DRY RUN — no writes'}: ${findings.length} bill(s)\n`);
    findings.forEach((f) => {
        console.log(`${f.wsName || f.wsId}  bill ${f.billId}  "${f.vendor}"`);
        console.log(`  face amount              ${rp(f.face)}`);
        console.log(`  A/P still in the ledger  ${rp(f.glNet)}   <- the truth`);
        console.log(`  subledger currently says ${rp(f.sub)}`);
        console.log(`  voided payment(s)        ${f.voided.map((v) => `${v.id} ${rp(v.amount)}`).join(', ')}`);
        console.log('  before ->  amount_paid=%s outstanding=%s status=%s budget=%s linked_txn=%s',
            rp(f.before.amount_paid), String(f.before.outstanding_amount), f.before.payment_status,
            String(f.before.budget_impact_status), String(f.before.linked_transaction_id));
        console.log('  after  ->  amount_paid=%s outstanding=%s status=%s%s%s',
            rp(f.after.amount_paid), rp(f.after.outstanding_amount), f.after.payment_status,
            'budget_impact_status' in f.after ? ` budget=${f.after.budget_impact_status}` : '',
            'linked_transaction_id' in f.after ? ' linked_txn=cleared' : '');
        console.log('');
    });

    if (!COMMIT) {
        console.log('Re-run with --commit to write these. Read the "after" line for every bill first —');
        console.log('each one restates a real payable.');
        process.exit(0);
    }

    for (const f of findings) {
        await db.collection('workspaces').doc(f.wsId).collection('bills').doc(f.billId).update({
            ...f.after,
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`  repaired ${f.wsId}/${f.billId}`);
    }
    console.log(`\nRepaired ${findings.length} bill(s). Re-run scripts/ledger-assert-report.js to confirm A/P ties.`);
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
