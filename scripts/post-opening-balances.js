// =============================================================================
// FluxyOS — Opening-balance cutover (accounting kernel)
//
// Posts ONE opening-balance journal for a workspace as of a cutover date, so the
// double-entry ledger starts from the business's real asset/liability position.
// New documents post forward from there (no mass backfill — that's the
// deliberate, lower-risk cutover chosen in the plan).
//
// SAFE BY DEFAULT: dry-run unless you pass --commit. Idempotent: refuses to run
// twice (skips if an OPENING journal already exists for the workspace).
//
// Opening position is read from existing data:
//   Cash & Bank (1000)        = Σ active bank_accounts.latest_balance
//   Accounts Receivable (1100) = Σ pending_receivable transactions (unsettled)
//   Accounts Payable (2000)    = Σ unpaid bills
//   …balanced to Opening Balance Equity (3900).
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/post-opening-balances.js --workspace <wsId> --cutover 2026-07-01 --dry-run
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/post-opening-balances.js --workspace <wsId> --cutover 2026-07-01 --commit
// =============================================================================

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const COMMIT = args.includes('--commit');
const WORKSPACE = flag('workspace', null);
const CUTOVER = flag('cutover', new Date().toISOString().slice(0, 10));

if (!WORKSPACE) {
    console.error('ERROR: --workspace <workspaceId> is required.');
    process.exit(1);
}

if (admin.apps.length === 0) {
    admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {});
}
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

// Minimal mirror of accounting-engine constants (inlined so this CJS admin script
// doesn't import the browser ESM module). Keep aligned with accounting-engine.js.
const SEED = [
    { code: '1000', name: 'Cash & Bank', type: 'asset' },
    { code: '1100', name: 'Accounts Receivable', type: 'asset' },
    { code: '2000', name: 'Accounts Payable', type: 'liability' },
    { code: '3000', name: 'Retained Earnings', type: 'equity' },
    { code: '3900', name: 'Opening Balance Equity', type: 'equity' },
    { code: '4000', name: 'Revenue', type: 'revenue' },
    { code: '6100', name: 'Marketing Expense', type: 'expense' },
    { code: '6200', name: 'Software / SaaS Expense', type: 'expense' },
    { code: '6300', name: 'Infrastructure Expense', type: 'expense' },
    { code: '6400', name: 'Operations Expense', type: 'expense' },
    { code: '6500', name: 'Tax Expense', type: 'expense' },
    { code: '6600', name: 'Bank Fees', type: 'expense' },
    { code: '6999', name: 'Other Expense', type: 'expense' }
];
const TYPE = SEED.reduce((m, a) => { m[a.code] = a.type; return m; }, {});
const periodKey = (isoDate) => isoDate.slice(0, 7);
const toInt = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };

async function main() {
    const base = db.collection('workspaces').doc(WORKSPACE);
    console.log(`\nWorkspace ${WORKSPACE} · cutover ${CUTOVER} · ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);

    // Idempotency guard.
    const existingOpening = await base.collection('journals').where('posting_rule_id', '==', 'OPENING').limit(1).get();
    if (!existingOpening.empty) {
        console.log('An OPENING journal already exists — nothing to do. Aborting.');
        return;
    }

    // Read opening positions.
    const [banks, bills, txns] = await Promise.all([
        base.collection('bank_accounts').get(),
        base.collection('bills').get(),
        base.collection('transactions').get()
    ]);
    let cash = 0;
    banks.forEach((d) => { const b = d.data(); if ((b.status || 'active') === 'active') cash += toInt(b.latest_balance); });
    let ap = 0;
    bills.forEach((d) => { const b = d.data(); if ((b.payment_status || 'unpaid') !== 'paid') ap += toInt(b.amount); });
    let ar = 0;
    txns.forEach((d) => { const t = d.data(); if (String(t.type || '').toLowerCase() === 'pending_receivable') ar += toInt(t.amount); });

    const lines = [];
    if (cash > 0) lines.push({ account_code: '1000', debit: cash, credit: 0 });
    if (ar > 0) lines.push({ account_code: '1100', debit: ar, credit: 0 });
    if (ap > 0) lines.push({ account_code: '2000', debit: 0, credit: ap });
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    const diff = debit - credit;
    if (diff > 0) lines.push({ account_code: '3900', debit: 0, credit: diff });
    else if (diff < 0) lines.push({ account_code: '3900', debit: -diff, credit: 0 });

    const fullLines = lines.map((l) => ({
        account_code: l.account_code,
        account_type: TYPE[l.account_code],
        debit: l.debit, credit: l.credit,
        currency: 'IDR', fx_rate: 1, functional_amount: l.debit || l.credit, memo: 'Opening balance'
    }));
    const totalDebit = fullLines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = fullLines.reduce((s, l) => s + l.credit, 0);

    console.log('  Cash & Bank (1000):        Rp' + cash.toLocaleString('id-ID'));
    console.log('  Accounts Receivable (1100): Rp' + ar.toLocaleString('id-ID'));
    console.log('  Accounts Payable (2000):    Rp' + ap.toLocaleString('id-ID'));
    console.log('  Opening Balance Equity (3900) balances the rest.');
    console.log(`  Journal: Dr Rp${totalDebit.toLocaleString('id-ID')} / Cr Rp${totalCredit.toLocaleString('id-ID')} ${totalDebit === totalCredit ? '(balanced)' : '(IMBALANCED!)'}`);

    if (totalDebit !== totalCredit || totalDebit <= 0) {
        console.error('  Nothing to post or imbalance detected — aborting.');
        return;
    }
    if (!COMMIT) {
        console.log('\nDRY-RUN: no writes. Re-run with --commit to post.');
        return;
    }

    const pk = periodKey(CUTOVER);
    const batch = db.batch();
    // Ensure CoA exists.
    const coaSnap = await base.collection('chart_of_accounts').get();
    const have = new Set(coaSnap.docs.map((d) => d.id));
    SEED.forEach((a) => {
        if (have.has(a.code)) return;
        batch.set(base.collection('chart_of_accounts').doc(a.code), {
            code: a.code, name: a.name, type: a.type, subtype: null, parent_code: null,
            normal_balance: (a.type === 'asset' || a.type === 'expense') ? 'debit' : 'credit',
            is_active: true, currency: 'IDR', entity_id: WORKSPACE, opening_balance: 0,
            created_at: FieldValue.serverTimestamp()
        });
    });
    // Journal.
    const journalRef = base.collection('journals').doc();
    batch.set(journalRef, {
        posting_rule_id: 'OPENING', source: { collection: null, id: null },
        period_key: pk, status: 'posted', memo: 'Opening balance', lines: fullLines,
        total_debit: totalDebit, total_credit: totalCredit, is_balanced: true,
        currency: 'IDR', entity_id: WORKSPACE, posted_by: 'system:opening-balance',
        posted_at: FieldValue.serverTimestamp(), created_at: FieldValue.serverTimestamp()
    });
    // Ledger balances.
    fullLines.forEach((l) => {
        batch.set(base.collection('ledger_balances').doc(`${pk}__${l.account_code}`), {
            period_key: pk, account_code: l.account_code, account_type: l.account_type,
            entity_id: WORKSPACE, currency: 'IDR',
            debit_total: FieldValue.increment(l.debit), credit_total: FieldValue.increment(l.credit),
            updated_at: FieldValue.serverTimestamp()
        }, { merge: true });
    });
    await batch.commit();
    console.log(`\nCOMMITTED opening journal ${journalRef.id} into period ${pk}.`);
}

main().then(() => process.exit(0)).catch((err) => { console.error('FATAL', err); process.exit(1); });
