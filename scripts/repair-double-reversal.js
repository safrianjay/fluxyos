// =============================================================================
// FluxyOS — correct ledger damage from a reversed reversal
//
// A reversal already neutralises its original, so reversing it RE-APPLIES the
// entry. Two code paths allowed it (both now guarded: reverseJournal + GL_070,
// and _correctSourceJournal); this repairs books that were hit before the fix.
//
// Found on production workspace Beila: JE-2026-000084 reversed JE-2026-000080,
// which was itself REVERSAL:INV-PAY, leaving Accounts Receivable at NEGATIVE
// Rp7.247.667 — A/R cannot hold a credit balance — and Cash overstated by the
// same Rp11.322.000. The aging report looked correct throughout, because it
// composes from invoices rather than ledger_balances.
//
// This does NOT delete or rewrite anything. It posts ONE balanced correcting
// journal per damaged chain, exactly inverting the offending entry, into an OPEN
// period. That is the accounting-correct remedy: you cannot un-post history, so
// you neutralise it with a new entry that says why.
//
// Idempotent: the correcting journal carries posting_rule_id 'CORRECT-DBLREV'
// and reverses_journal_id = the bad journal, so a second run finds it and stops.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/repair-double-reversal.js --workspace <wsId>            # dry-run
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/repair-double-reversal.js --workspace <wsId> --commit
//
// AFTER --commit:
//   node scripts/backfill-journal-numbers.js --workspace <wsId> --commit
//   node scripts/reconcile-ledger-balances.js --workspace <wsId> --commit
//   node scripts/ledger-assert-report.js --workspace <wsId>
// =============================================================================

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const COMMIT = args.includes('--commit');
const WORKSPACE = flag('workspace', null);

if (!WORKSPACE) { console.error('ERROR: --workspace <workspaceId> is required.'); process.exit(1); }
if (!admin.apps.length) admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {});
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const rp = (n) => 'Rp' + (Number(n) || 0).toLocaleString('id-ID');
const toInt = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const RULE = 'CORRECT-DBLREV';

async function main() {
    const base = db.collection('workspaces').doc(WORKSPACE);
    console.log(`\nDouble-reversal repair — ${WORKSPACE} — ${COMMIT ? 'COMMIT' : 'DRY-RUN (no writes)'}\n`);

    const [jSnap, pSnap] = await Promise.all([
        base.collection('journals').get(),
        base.collection('periods').get()
    ]);
    const all = jSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const byId = new Map(all.map((j) => [j.id, j]));
    const closed = new Set();
    pSnap.forEach((d) => { const p = d.data(); if (p.status === 'closed' || p.status === 'locked') closed.add(p.period_key); });

    // Damage = a posted journal that reverses another journal which is ITSELF a
    // reversal. Checked structurally rather than by rule-id string so a chain
    // built by the automatic path (which does not prefix REVERSAL:REVERSAL) is
    // caught too.
    const damaged = all.filter((j) => {
        if (j.status === 'draft') return false;
        if (j.posting_rule_id === RULE) return false;
        const parent = j.reverses_journal_id ? byId.get(j.reverses_journal_id) : null;
        return !!parent && parent.status === 'reversal';
    });

    const alreadyFixed = new Set(
        all.filter((j) => j.posting_rule_id === RULE && j.reverses_journal_id).map((j) => j.reverses_journal_id)
    );

    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const target = closed.has(current) ? null : current;

    const plan = [];
    for (const bad of damaged) {
        if (alreadyFixed.has(bad.id)) continue;
        // Invert every line: this neutralises the re-applied entry precisely.
        const lines = (bad.lines || []).map((l) => ({
            account_code: l.account_code, account_type: l.account_type, account_name: l.account_name || l.account_code,
            debit: toInt(l.credit), credit: toInt(l.debit), currency: 'IDR', fx_rate: 1,
            functional_amount: toInt(l.credit) || toInt(l.debit),
            memo: `Correcting ${bad.journal_number || bad.id}`
        })).filter((l) => l.debit > 0 || l.credit > 0);
        if (!lines.length) continue;
        const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
        const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
        if (totalDebit !== totalCredit || totalDebit <= 0) {
            console.warn(`  ! skipping ${bad.id}: inverted lines do not balance`);
            continue;
        }
        plan.push({ bad, lines, totalDebit });
    }

    if (!plan.length) {
        console.log(`Nothing to repair. (${damaged.length} double-reversal(s) found, ${damaged.length ? 'all already corrected' : 'none present'})\n`);
        process.exit(0);
    }
    if (!target) { console.error(`ERROR: current period ${current} is closed — reopen it, then re-run.\n`); process.exit(1); }

    console.log(`${plan.length} damaged chain(s):`);
    plan.forEach(({ bad, lines, totalDebit }) => {
        console.log(`  ${bad.journal_number || bad.id}  ${bad.posting_rule_id}  ${rp(totalDebit)}  → correcting entry in ${target}`);
        lines.forEach((l) => console.log(`      ${l.account_code} ${String(l.account_name).slice(0, 22).padEnd(22)} Dr ${rp(l.debit).padStart(14)}  Cr ${rp(l.credit).padStart(14)}`));
    });

    if (!COMMIT) { console.log('\nDry-run only. Re-run with --commit to post the correcting entries.\n'); process.exit(0); }

    const batch = db.batch();
    for (const { bad, lines, totalDebit } of plan) {
        const ref = base.collection('journals').doc();
        batch.set(ref, {
            journal_type: 'system', posting_rule_id: RULE, manual_subtype: 'correction',
            source: bad.source || { collection: null, id: null }, source_number: bad.source_number || null,
            period_key: target, status: 'posted',
            description: `Correction: ${bad.journal_number || bad.id} reversed a reversal and re-applied it`,
            memo: 'Automated repair — scripts/repair-double-reversal.js',
            reverses_journal_id: bad.id,
            lines, total_debit: totalDebit, total_credit: totalDebit, is_balanced: true,
            currency: 'IDR', entity_id: WORKSPACE,
            generated_by: 'posting_engine', posted_by: 'system:double-reversal-repair',
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
    }
    await batch.commit();

    console.log(`\nPosted ${plan.length} correcting entr${plan.length === 1 ? 'y' : 'ies'} into ${target}.`);
    console.log('Next, in order:');
    console.log(`  node scripts/backfill-journal-numbers.js --workspace ${WORKSPACE} --commit`);
    console.log(`  node scripts/reconcile-ledger-balances.js --workspace ${WORKSPACE} --commit`);
    console.log(`  node scripts/ledger-assert-report.js --workspace ${WORKSPACE}\n`);
    process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
