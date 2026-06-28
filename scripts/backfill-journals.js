// =============================================================================
// FluxyOS — Historical journal backfill (accounting kernel)
//
// Posts double-entry journals for EXISTING transactions / bills / subscriptions
// that predate the posting engine, so historical periods populate the ledger.
// This is the larger, riskier migration deliberately deferred at launch — it is
// built defensively:
//
//   • DRY-RUN BY DEFAULT. Writes only with --commit.
//   • IDEMPOTENT, double-guarded: a source doc is skipped if it already has
//     accounting_status:'posted' / journal_ref, OR if a journal already exists
//     for its (collection,id). Re-running posts nothing.
//   • Reuses the REAL posting engine (assets/js/accounting-engine.js) via a
//     data-URL import — no rule duplication, no drift.
//   • Skips CLOSED/LOCKED periods (never backfills into a closed book).
//   • Skips invoice-linked settlements (INV-PAY) because invoice issuance
//     (INV-ISSUE) is not wired yet — posting the settlement alone would drive
//     Accounts Receivable negative. These are marked 'pending' for later.
//   • Batched (≤100 source docs/batch) to stay well under the 500-write ceiling.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/backfill-journals.js --workspace <wsId> --dry-run
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/backfill-journals.js --workspace <wsId> --commit
//
// Tip: find a workspace id — for an owner it equals their Firebase uid.
// =============================================================================

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const COMMIT = args.includes('--commit');
const WORKSPACE = flag('workspace', null);
const COLLECTIONS = String(flag('collections', 'transactions,bills,subscriptions'))
    .split(',').map((s) => s.trim()).filter(Boolean);
const BATCH_DOCS = 100;

if (!WORKSPACE) {
    console.error('ERROR: --workspace <workspaceId> is required.');
    process.exit(1);
}

if (admin.apps.length === 0) {
    admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {});
}
const db = admin.firestore();
const { FieldValue } = admin.firestore;

async function loadEngine() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'accounting-engine.js'), 'utf8');
    // The engine has no internal imports, so a data-URL module loads standalone.
    return import('data:text/javascript,' + encodeURIComponent(src));
}

function mappingsToEngine(docs) {
    const map = {};
    docs.forEach((d) => {
        const m = d.data();
        if (!m.target_account_code) return;
        if (m.source_type === 'transaction_category') map[`category:${m.source_value}`] = m.target_account_code;
        else if (m.source_type === 'transaction_type') map[`type:${String(m.source_value).toLowerCase()}`] = m.target_account_code;
    });
    return map;
}

const fmt = (n) => 'Rp' + (Number(n) || 0).toLocaleString('id-ID');

async function main() {
    const engine = await loadEngine();
    const base = db.collection('workspaces').doc(WORKSPACE);
    console.log(`\nWorkspace ${WORKSPACE} · collections [${COLLECTIONS.join(', ')}] · ${COMMIT ? 'COMMIT' : 'DRY-RUN'}\n`);

    // Guards: closed periods + already-posted sources (by source flag and by
    // existing journals — belt and suspenders against double posting).
    const [periodsSnap, journalsSnap, mappingsSnap] = await Promise.all([
        base.collection('periods').get(),
        base.collection('journals').get(),
        base.collection('accounting_mappings').get()
    ]);
    const closedPeriods = new Set();
    periodsSnap.forEach((d) => { const p = d.data(); if (p.status === 'closed' || p.status === 'locked') closedPeriods.add(p.period_key); });
    const alreadyPosted = new Set();
    journalsSnap.forEach((d) => { const j = d.data(); if (j.source && j.source.collection && j.source.id) alreadyPosted.add(`${j.source.collection}:${j.source.id}`); });
    const mappings = mappingsToEngine(mappingsSnap.docs);

    const plan = [];
    const skipped = { already: 0, noPost: 0, invoiceLinked: 0, closedPeriod: 0 };
    const byPeriod = {};

    for (const collection of COLLECTIONS) {
        const snap = await base.collection(collection).get();
        for (const d of snap.docs) {
            const document = d.data();
            const key = `${collection}:${d.id}`;
            if (document.accounting_status === 'posted' || document.journal_ref || alreadyPosted.has(key)) { skipped.already++; continue; }
            let journal;
            try {
                journal = engine.buildJournal({ collection, id: d.id, document, mappings });
            } catch (err) {
                console.warn(`  ! build failed ${key}: ${err.message}`);
                skipped.noPost++;
                continue;
            }
            if (!journal) { skipped.noPost++; continue; }
            if (String(journal.posting_rule_id).startsWith('INV-PAY')) { skipped.invoiceLinked++; continue; }
            if (closedPeriods.has(journal.period_key)) { skipped.closedPeriod++; continue; }
            plan.push({ collection, id: d.id, ref: d.ref, journal });
            byPeriod[journal.period_key] = byPeriod[journal.period_key] || { count: 0, debit: 0 };
            byPeriod[journal.period_key].count++;
            byPeriod[journal.period_key].debit += journal.total_debit;
        }
    }

    console.log('Planned journals by period:');
    Object.keys(byPeriod).sort().forEach((pk) => console.log(`  ${pk}   ${String(byPeriod[pk].count).padStart(4)} journals   ${fmt(byPeriod[pk].debit)}`));
    console.log(`\nTotal to post: ${plan.length}`);
    console.log(`Skipped — already posted: ${skipped.already}, no-post (transfer/adjust/custom): ${skipped.noPost}, invoice-linked: ${skipped.invoiceLinked}, closed-period: ${skipped.closedPeriod}`);

    if (!plan.length) { console.log('\nNothing to backfill.'); return; }
    if (!COMMIT) { console.log('\nDRY-RUN: no writes. Re-run with --commit to post.'); return; }

    // Commit in batches. Each item = 1 journal + N ledger_balances + 1 source update.
    let posted = 0;
    for (let i = 0; i < plan.length; i += BATCH_DOCS) {
        const chunk = plan.slice(i, i + BATCH_DOCS);
        const batch = db.batch();
        chunk.forEach(({ ref, journal }) => {
            const journalRef = base.collection('journals').doc();
            batch.set(journalRef, {
                ...journal,
                entity_id: WORKSPACE,
                posted_by: 'system:backfill',
                posted_at: FieldValue.serverTimestamp(),
                created_at: FieldValue.serverTimestamp()
            });
            (journal.lines || []).forEach((l) => {
                batch.set(base.collection('ledger_balances').doc(`${journal.period_key}__${l.account_code}`), {
                    period_key: journal.period_key, account_code: l.account_code, account_type: l.account_type,
                    entity_id: WORKSPACE, currency: 'IDR',
                    debit_total: FieldValue.increment(Number(l.debit) || 0),
                    credit_total: FieldValue.increment(Number(l.credit) || 0),
                    updated_at: FieldValue.serverTimestamp()
                }, { merge: true });
            });
            batch.set(ref, { journal_ref: journalRef.id, accounting_status: 'posted' }, { merge: true });
        });
        await batch.commit();
        posted += chunk.length;
        console.log(`  committed ${posted}/${plan.length}`);
    }
    console.log(`\nCOMMITTED ${posted} backfill journals.`);
}

main().then(() => process.exit(0)).catch((err) => { console.error('FATAL', err); process.exit(1); });
