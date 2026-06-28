// =============================================================================
// FluxyOS — Ledger balance reconciliation (accounting kernel)
//
// The compensating control for client-side posting: Firestore rules verify that a
// journal's TOTALS balance (Σdebit == Σcredit) but cannot sum the lines[] array,
// so a buggy/forged client could in principle write balanced totals with lopsided
// lines — drifting the running `ledger_balances` (which are written via
// FieldValue.increment) away from the authoritative journals.
//
// This script recomputes every account/period balance directly from the journal
// LINES (the source of truth), compares against the stored ledger_balances, and:
//   • DRY-RUN (default): reports drift, missing, and orphan balances + a global
//     trial-balance check (Σdebit == Σcredit across all journals).
//   • --commit: overwrites ledger_balances with the recomputed absolute totals.
//
// Drafts (status 'draft') never post to the ledger and are excluded. Idempotent:
// a clean ledger produces no changes.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/reconcile-ledger-balances.js --workspace <wsId> --dry-run
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/reconcile-ledger-balances.js --workspace <wsId> --commit
// =============================================================================

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const COMMIT = args.includes('--commit');
const WORKSPACE = flag('workspace', null);
const ONLY_PERIOD = flag('period', null); // optional 'YYYY-MM'

if (!WORKSPACE) {
    console.error('ERROR: --workspace <workspaceId> is required.');
    process.exit(1);
}
if (admin.apps.length === 0) {
    admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {});
}
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const fmt = (n) => 'Rp' + (Number(n) || 0).toLocaleString('id-ID');
const toInt = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };

async function main() {
    const base = db.collection('workspaces').doc(WORKSPACE);
    console.log(`\nWorkspace ${WORKSPACE}${ONLY_PERIOD ? ` · period ${ONLY_PERIOD}` : ''} · ${COMMIT ? 'COMMIT' : 'DRY-RUN'}\n`);

    // 1) Recompute expected balances from journal LINES (drafts excluded).
    const journalsSnap = await base.collection('journals').get();
    const expected = {}; // key `${period}__${account}` -> { period_key, account_code, account_type, debit, credit }
    let globalDebit = 0;
    let globalCredit = 0;
    let counted = 0;
    journalsSnap.forEach((d) => {
        const j = d.data();
        if (j.status === 'draft') return; // drafts never post
        if (ONLY_PERIOD && j.period_key !== ONLY_PERIOD) return;
        (j.lines || []).forEach((l) => {
            const key = `${j.period_key}__${l.account_code}`;
            const e = expected[key] || (expected[key] = {
                period_key: j.period_key, account_code: l.account_code,
                account_type: l.account_type, debit: 0, credit: 0
            });
            e.debit += toInt(l.debit);
            e.credit += toInt(l.credit);
            globalDebit += toInt(l.debit);
            globalCredit += toInt(l.credit);
        });
        counted += 1;
    });

    // 2) Load stored ledger_balances.
    const balSnap = await base.collection('ledger_balances').get();
    const stored = {};
    balSnap.forEach((d) => {
        const b = d.data();
        if (ONLY_PERIOD && b.period_key !== ONLY_PERIOD) return;
        stored[d.id] = { id: d.id, debit: toInt(b.debit_total), credit: toInt(b.credit_total), period_key: b.period_key, account_code: b.account_code, account_type: b.account_type };
    });

    // 3) Compare.
    const drift = [];   // mismatched
    const missing = []; // expected but no stored doc
    const orphan = [];  // stored doc but no journals back it
    Object.keys(expected).forEach((key) => {
        const e = expected[key];
        const s = stored[key];
        if (!s) { missing.push(e); return; }
        if (s.debit !== e.debit || s.credit !== e.credit) drift.push({ key, e, s });
    });
    Object.keys(stored).forEach((key) => {
        if (!expected[key] && (stored[key].debit !== 0 || stored[key].credit !== 0)) orphan.push(stored[key]);
    });

    console.log(`Journals counted: ${counted} (drafts excluded)`);
    console.log(`Global check: Σdebit ${fmt(globalDebit)} / Σcredit ${fmt(globalCredit)} ${globalDebit === globalCredit ? '(balanced ✓)' : '(OUT OF BALANCE ✗ — a lopsided journal exists)'}`);
    console.log(`Accounts expected: ${Object.keys(expected).length} · stored: ${Object.keys(stored).length}`);
    console.log(`Drift: ${drift.length} · Missing: ${missing.length} · Orphan: ${orphan.length}\n`);

    drift.slice(0, 50).forEach(({ e, s }) => {
        console.log(`  DRIFT ${e.period_key} ${e.account_code}: stored Dr ${fmt(s.debit)}/Cr ${fmt(s.credit)} → expected Dr ${fmt(e.debit)}/Cr ${fmt(e.credit)}`);
    });
    missing.slice(0, 50).forEach((e) => console.log(`  MISSING ${e.period_key} ${e.account_code}: expected Dr ${fmt(e.debit)}/Cr ${fmt(e.credit)}`));
    orphan.slice(0, 50).forEach((s) => console.log(`  ORPHAN ${s.period_key} ${s.account_code}: stored Dr ${fmt(s.debit)}/Cr ${fmt(s.credit)} → should be 0`));

    const changes = drift.length + missing.length + orphan.length;
    if (!changes) { console.log('\nLedger balances are in sync with the journals. Nothing to do.'); return; }
    if (!COMMIT) { console.log(`\nDRY-RUN: ${changes} balance docs would be rewritten. Re-run with --commit to fix.`); return; }

    // 4) Fix: overwrite drifted/missing with recomputed absolute totals; zero orphans.
    const entityId = WORKSPACE;
    const writes = [];
    drift.forEach(({ e }) => writes.push(e));
    missing.forEach((e) => writes.push(e));
    orphan.forEach((s) => writes.push({ period_key: s.period_key, account_code: s.account_code, account_type: s.account_type, debit: 0, credit: 0 }));

    let written = 0;
    for (let i = 0; i < writes.length; i += 400) {
        const slice = writes.slice(i, i + 400);
        const batch = db.batch();
        slice.forEach((e) => {
            batch.set(base.collection('ledger_balances').doc(`${e.period_key}__${e.account_code}`), {
                period_key: e.period_key, account_code: e.account_code, account_type: e.account_type,
                entity_id: entityId, currency: 'IDR',
                debit_total: e.debit, credit_total: e.credit, // absolute, authoritative
                reconciled_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp()
            }, { merge: true });
        });
        await batch.commit();
        written += slice.length;
    }
    console.log(`\nCOMMITTED ${written} corrected balance docs.`);
}

main().then(() => process.exit(0)).catch((err) => { console.error('FATAL', err); process.exit(1); });
