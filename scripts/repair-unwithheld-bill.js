// =============================================================================
// FluxyOS — reverse a PPh withholding that was accrued but never actually withheld
//
// BILL-ACCRUE grafts Dr A/P / Cr 2110 whenever a bill carries a withholding_rate,
// on the assumption the supplier will be paid NET and the withheld portion remitted
// to DJP. When the supplier was in fact paid the FULL amount, that assumption is
// wrong in two places at once:
//   • A/P was credited net but debited gross at payment → control account short
//   • 2110 holds a PPh liability that was never withheld and is not owed
//
// Detected structurally: a PAID bill whose journals credit 2110, where the
// settlement debited A/P the bill's GROSS amount. Confirm with the business before
// running — whether the vendor got gross or net is a real-world fact the ledger
// cannot know. Beila / Vendor A (INV bill k65vCzt…, Rp72.072) was confirmed gross.
//
// Posts ONE balanced correcting entry per bill: Dr 2110 / Cr 2000. Never deletes,
// never touches a closed period (lands in the current open one). Idempotent via
// posting_rule_id 'CORRECT-UNWITHHELD' + reverses_journal_id.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/repair-unwithheld-bill.js --workspace <wsId> [--bill <billId>]
//   …same, plus --commit
// =============================================================================

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const COMMIT = args.includes('--commit');
const WORKSPACE = flag('workspace', null);
const ONLY_BILL = flag('bill', null);
const RULE = 'CORRECT-UNWITHHELD';

if (!WORKSPACE) { console.error('ERROR: --workspace <workspaceId> is required.'); process.exit(1); }
if (!admin.apps.length) admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {});
const db = admin.firestore();
const { FieldValue } = admin.firestore;
const rp = (n) => 'Rp' + (Number(n) || 0).toLocaleString('id-ID');
const I = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };

async function main() {
    const base = db.collection('workspaces').doc(WORKSPACE);
    console.log(`\nUn-withheld bill repair — ${WORKSPACE} — ${COMMIT ? 'COMMIT' : 'DRY-RUN (no writes)'}\n`);

    const [bills, jr, txs, periods] = await Promise.all([
        base.collection('bills').get(), base.collection('journals').get(),
        base.collection('transactions').get(), base.collection('periods').get()
    ]);
    const txById = {}; txs.forEach((d) => { txById[d.id] = d.data(); });
    const closed = new Set();
    periods.forEach((d) => { const p = d.data(); if (p.status === 'closed' || p.status === 'locked') closed.add(p.period_key); });

    // Per bill: PPh credited to 2110 at accrual, and A/P debited at settlement.
    const withheld = {}; const settled = {}; const accrualJournal = {}; const alreadyFixed = new Set();
    jr.forEach((d) => {
        const j = d.data(); if (j.status === 'draft') return;
        const rule = String(j.posting_rule_id || '');
        if (rule === RULE && j.reverses_journal_id) alreadyFixed.add(j.reverses_journal_id);
        if (rule.includes('BILL-ACCRUE')) {
            const bid = j.source?.id; if (!bid) return;
            const pph = (j.lines || []).filter((l) => l.account_code === '2110').reduce((s, l) => s + I(l.credit) - I(l.debit), 0);
            if (pph > 0) { withheld[bid] = (withheld[bid] || 0) + pph; accrualJournal[bid] = d.id; }
        } else if (rule.includes('BILL-PAY')) {
            const bid = txById[j.source?.id]?.linked_bill_id; if (!bid) return;
            settled[bid] = (settled[bid] || 0) + (j.lines || []).filter((l) => l.account_code === '2000').reduce((s, l) => s + I(l.debit) - I(l.credit), 0);
        }
    });

    const plan = [];
    bills.forEach((d) => {
        if (ONLY_BILL && d.id !== ONLY_BILL) return;
        const b = d.data() || {};
        const pph = withheld[d.id] || 0;
        if (!pph) return;
        if (alreadyFixed.has(accrualJournal[d.id])) return;
        const gross = I(Math.abs(b.amount));
        const paid = settled[d.id] || 0;
        // The signature: settlement debited the GROSS, so the vendor was paid in full
        // and nothing was actually withheld.
        if (paid !== gross) return;
        plan.push({ id: d.id, vendor: b.vendor_name || '?', gross, pph, accrual: accrualJournal[d.id] });
    });

    if (!plan.length) { console.log('Nothing to repair.\n'); process.exit(0); }

    const now = new Date();
    const target = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (closed.has(target)) { console.error(`ERROR: current period ${target} is closed — reopen it, then re-run.\n`); process.exit(1); }

    console.log(`${plan.length} bill(s) paid GROSS despite an accrued withholding:`);
    plan.forEach((p) => console.log(`  ${p.id.slice(0, 16)} ${String(p.vendor).slice(0, 24).padEnd(24)} bill ${rp(p.gross)} · settled ${rp(p.gross)} · PPh accrued ${rp(p.pph)}`));
    console.log(`\n  correcting entry per bill, in ${target}:  Dr 2110 PPh Payable / Cr 2000 Accounts Payable`);
    console.log(`  total: ${rp(plan.reduce((s, p) => s + p.pph, 0))}`);

    if (!COMMIT) { console.log('\nDry-run only. Re-run with --commit.\n'); process.exit(0); }

    const batch = db.batch();
    for (const p of plan) {
        const lines = [
            { account_code: '2110', account_type: 'liability', account_name: 'PPh Payable', debit: p.pph, credit: 0, currency: 'IDR', fx_rate: 1, functional_amount: p.pph, memo: 'PPh not withheld — supplier paid gross' },
            { account_code: '2000', account_type: 'liability', account_name: 'Accounts Payable', debit: 0, credit: p.pph, currency: 'IDR', fx_rate: 1, functional_amount: p.pph, memo: 'Restore A/P settled gross' }
        ];
        const ref = base.collection('journals').doc();
        batch.set(ref, {
            journal_type: 'system', posting_rule_id: RULE, manual_subtype: 'correction',
            source: { collection: 'bills', id: p.id }, source_number: null,
            period_key: target, status: 'posted',
            description: `Correction: PPh ${rp(p.pph)} accrued but not withheld — ${p.vendor} was paid gross`,
            memo: 'Automated repair — scripts/repair-unwithheld-bill.js',
            reverses_journal_id: p.accrual || null,
            lines, total_debit: p.pph, total_credit: p.pph, is_balanced: true,
            currency: 'IDR', entity_id: WORKSPACE, generated_by: 'posting_engine',
            posted_by: 'system:unwithheld-repair',
            posted_at: FieldValue.serverTimestamp(), created_at: FieldValue.serverTimestamp()
        });
        lines.forEach((l) => {
            batch.set(base.collection('ledger_balances').doc(`${target}__${l.account_code}`), {
                period_key: target, account_code: l.account_code, account_type: l.account_type,
                entity_id: WORKSPACE, currency: 'IDR',
                debit_total: FieldValue.increment(l.debit), credit_total: FieldValue.increment(l.credit),
                updated_at: FieldValue.serverTimestamp()
            }, { merge: true });
        });
        // The bill no longer claims a withholding: clear the stamp so the payment
        // path and the assertions stop netting it.
        batch.set(base.collection('bills').doc(p.id), { withholding_amount: 0 }, { merge: true });
    }
    await batch.commit();
    console.log(`\nPosted ${plan.length} correcting entr${plan.length === 1 ? 'y' : 'ies'} into ${target}.`);
    console.log(`Next: node scripts/backfill-journal-numbers.js --workspace ${WORKSPACE} --commit`);
    console.log(`      node scripts/ledger-assert-report.js --workspace ${WORKSPACE}\n`);
    process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
