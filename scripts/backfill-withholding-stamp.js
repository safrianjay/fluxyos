// =============================================================================
// FluxyOS — stamp withholding_amount on bills accrued before the stamp existed
//
// billWithheldAmount() reads ONLY bill.withholding_amount, never derives it from
// withholding_rate — because the tax appendix is skipped when a workspace has no
// tax profile, so a rate does not mean anything was withheld (that assumption
// produced a phantom Rp1.038.013 A/P gap on a correct ledger).
//
// The cost of that correctness: bills accrued BEFORE _applyTaxAppendix started
// stamping report 0, so their A/P is netted in the GL but counted gross in the
// subledger — a standing ap_subledger discrepancy of exactly the withheld total.
//
// This reads what was ACTUALLY posted (the 2110 credit on each bill's BILL-ACCRUE
// journal) and writes it back as the stamp. It never derives from the rate, never
// touches a bill whose accrual withheld nothing, and never touches the ledger —
// it only records on the document what the journal already says.
//
// Idempotent: a bill already carrying a matching stamp is skipped.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/backfill-withholding-stamp.js --workspace <wsId> [--commit]
//   …omit --workspace to sweep every workspace.
// =============================================================================

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const COMMIT = args.includes('--commit');
const ONLY_WS = flag('workspace', null);

if (!admin.apps.length) admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {});
const db = admin.firestore();
const rp = (n) => 'Rp' + (Number(n) || 0).toLocaleString('id-ID');
const I = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };

async function forWorkspace(wsId, name) {
    const base = db.collection('workspaces').doc(wsId);
    const [bills, jr] = await Promise.all([base.collection('bills').get(), base.collection('journals').get()]);

    // PPh still standing against each bill in 2110 — the NET across every journal
    // sourced from that bill, not just its accrual. A withholding later corrected
    // away (repair-unwithheld-bill.js posts Dr 2110) nets to zero and must not be
    // re-stamped, or this script would silently undo that repair.
    const posted = {};
    jr.forEach((d) => {
        const j = d.data();
        if (j.status === 'draft') return;
        const bid = j.source?.collection === 'bills' ? j.source?.id : null;
        if (!bid) return;
        const pph = (j.lines || []).filter((l) => l.account_code === '2110').reduce((s, l) => s + I(l.credit) - I(l.debit), 0);
        if (pph) posted[bid] = (posted[bid] || 0) + pph;
    });
    Object.keys(posted).forEach((k) => { if (posted[k] <= 0) delete posted[k]; });

    const plan = [];
    bills.forEach((d) => {
        const pph = posted[d.id] || 0;
        if (!pph) return;
        if (I(d.data().withholding_amount) === pph) return; // already stamped
        plan.push({ id: d.id, vendor: d.data().vendor_name || '?', pph });
    });
    if (!plan.length) return { name, wsId, n: 0, total: 0 };

    if (COMMIT) {
        for (let i = 0; i < plan.length; i += 400) {
            const batch = db.batch();
            plan.slice(i, i + 400).forEach((p) => batch.set(base.collection('bills').doc(p.id), { withholding_amount: p.pph }, { merge: true }));
            await batch.commit();
        }
    }
    return { name, wsId, n: plan.length, total: plan.reduce((s, p) => s + p.pph, 0) };
}

async function main() {
    console.log(`\nWithholding stamp backfill — ${COMMIT ? 'COMMIT' : 'DRY-RUN (no writes)'}\n`);
    const ids = ONLY_WS ? [ONLY_WS] : (await db.collection('workspaces').get()).docs.map((d) => d.id);
    let totalBills = 0;
    let totalPph = 0;
    for (const id of ids) {
        const doc = await db.collection('workspaces').doc(id).get();
        const r = await forWorkspace(id, doc.data()?.name || id);
        if (r.n) {
            console.log(`  ${String(r.name).slice(0, 28).padEnd(28)} ${String(r.n).padStart(4)} bill(s)  ${rp(r.total)}`);
            totalBills += r.n; totalPph += r.total;
        }
    }
    console.log(totalBills
        ? `\n${totalBills} bill(s) to stamp · ${rp(totalPph)} of PPh actually withheld`
        : '\nNothing to stamp — every withheld bill already carries its amount.');
    if (!COMMIT && totalBills) console.log('Dry-run only. Re-run with --commit.');
    console.log('');
    process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
