// =============================================================================
// FluxyOS — re-post historical commerce journals through 1030 Clearing
//
// Corrects marketplace orders posted BEFORE the CM-* rules shipped (2026-08-03).
// See docs/ACCOUNTING_SPEC_REVIEW.md §7.4b for the defect.
//
// What was wrong, per order (gross 1,000,000 / fee 120,000 / refund 200,000):
//     recorded cash 1,080,000  ·  actual cash 680,000   → +400,000
//     recorded revenue 1,200,000 · true net 800,000     → +400,000
// Cash was debited GROSS on the order date and the payout never posted at all
// (settlements were accounting_status:'excluded'), so the error is permanent —
// there is no later entry that washes it off. Refunds compounded it: they used
// the generic `refund` type, which in FluxyOS means a refund RECEIVED, so a
// return moved cash and revenue the wrong way.
//
// What this does, per affected source:
//   income/refund/fee with an OLD journal → reverse it, repost under CM-*
//   settlement (transfer, 'excluded')     → post CM-SETTLE (it never had one)
//
// CLOSED BOOKS ARE NEVER REWRITTEN. Both the reversal and the repost land in an
// OPEN period (the kernel's correction-in-current-period rule), so a closed
// period keeps the numbers it was closed with and the correction is visible in
// the period you are actually working in.
//
// Idempotent: a journal already on a CM-* rule is skipped, so re-running is safe.
// Dry-run unless --commit. Never deletes: corrections are reversals, per §3.2.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/backfill-commerce-clearing.js --workspace <wsId>
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/backfill-commerce-clearing.js --workspace <wsId> --commit
//
// AFTER --commit, in this order:
//   node scripts/backfill-journal-numbers.js --workspace <wsId> --commit
//   node scripts/reconcile-ledger-balances.js --workspace <wsId> --commit
//   node scripts/ledger-assert-report.js --workspace <wsId>
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
const CHUNK = 100;

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

async function loadEngine() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'accounting-engine.js'), 'utf8');
    // The engine has no internal imports, so a data-URL module loads standalone.
    // Reusing it is the point: the repost must be byte-identical to what the app
    // would write today, or the backfill invents a third posting behaviour.
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

// Period to land corrections in: the earliest OPEN period at or after the source's
// own period, falling back to the current month. Keeps a correction as close to
// its origin as the books allow without reopening anything.
function correctionPeriod(sourcePeriod, closedPeriods) {
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (sourcePeriod && !closedPeriods.has(sourcePeriod)) return sourcePeriod;
    return closedPeriods.has(current) ? null : current;
}

async function main() {
    const engine = await loadEngine();
    const base = db.collection('workspaces').doc(WORKSPACE);
    console.log(`\nCommerce clearing backfill — workspace ${WORKSPACE} — ${COMMIT ? 'COMMIT' : 'DRY-RUN (no writes)'}\n`);

    const [periodsSnap, journalsSnap, mappingsSnap, txSnap] = await Promise.all([
        base.collection('periods').get(),
        base.collection('journals').get(),
        base.collection('accounting_mappings').get(),
        base.collection('transactions').where('source', '==', 'commerce').get()
    ]);

    const closedPeriods = new Set();
    periodsSnap.forEach((d) => { const p = d.data(); if (p.status === 'closed' || p.status === 'locked') closedPeriods.add(p.period_key); });
    const mappings = mappingsToEngine(mappingsSnap.docs);

    // Live journals by source id. Reversed/reversal rows are ignored: a journal
    // already reversed has been dealt with, and reversals are not themselves sources.
    const journalBySource = new Map();
    journalsSnap.forEach((d) => {
        const j = d.data();
        if (!j.source || j.source.collection !== 'transactions' || !j.source.id) return;
        if (j.status === 'reversal' || j.status === 'reversed' || j.reversed_by_journal_id) return;
        journalBySource.set(j.source.id, { id: d.id, ...j });
    });

    const plan = [];
    const skip = { alreadyNew: 0, noRule: 0, noOpenPeriod: 0, noJournalNotSettlement: 0 };
    let cashDelta = 0;

    for (const d of txSnap.docs) {
        const document = d.data();
        if (document.is_voided) continue;
        const existing = journalBySource.get(d.id) || null;

        // Already on the new rules → nothing to do (idempotency).
        if (existing && String(existing.posting_rule_id || '').startsWith('CM-')) { skip.alreadyNew++; continue; }

        let rebuilt;
        try {
            rebuilt = engine.buildJournal({
                collection: 'transactions', id: d.id, document, mappings,
                date: document.timestamp || null
            });
        } catch (err) {
            console.warn(`  ! build failed transactions:${d.id} — ${err.message}`);
            skip.noRule++;
            continue;
        }
        if (!rebuilt) { skip.noRule++; continue; }

        // A commerce row with no journal that is NOT a settlement was simply never
        // posted; that is the ordinary coverage gap, and backfill-journals.js owns
        // it. Staying out of its lane keeps the two scripts from double-posting.
        if (!existing && rebuilt.posting_rule_id !== 'CM-SETTLE') { skip.noJournalNotSettlement++; continue; }

        const target = correctionPeriod(existing ? existing.period_key : rebuilt.period_key, closedPeriods);
        if (!target) { skip.noOpenPeriod++; continue; }

        const reversal = existing ? engine.buildReversalJournal({ ...existing }, { targetPeriodKey: target }) : null;
        const repost = { ...rebuilt, period_key: target };

        // Net cash effect of the correction, for the dry-run summary.
        const cashOf = (j, sign) => (j?.lines || []).reduce((s, l) =>
            l.account_code === '1000' ? s + sign * (toInt(l.debit) - toInt(l.credit)) : s, 0);
        cashDelta += cashOf(reversal, 1) + cashOf(repost, 1);

        plan.push({
            ref: d.ref, id: d.id, type: document.type, amount: toInt(document.amount),
            from: existing ? existing.posting_rule_id : '(none)', to: rebuilt.posting_rule_id,
            existingId: existing ? existing.id : null, reversal, repost, target
        });
    }

    if (!plan.length) {
        console.log('Nothing to correct.');
        console.log(`  skipped: ${skip.alreadyNew} already on CM-* · ${skip.noRule} no rule · `
            + `${skip.noJournalNotSettlement} unposted (use backfill-journals.js) · ${skip.noOpenPeriod} no open period\n`);
        process.exit(0);
    }

    const byRule = {};
    plan.forEach((p) => { const k = `${p.from} → ${p.to}`; byRule[k] = (byRule[k] || 0) + 1; });
    console.log(`${plan.length} source(s) to correct:`);
    Object.entries(byRule).sort().forEach(([k, n]) => console.log(`   ${String(n).padStart(5)}  ${k}`));
    console.log(`\n  net cash correction: ${fmt(cashDelta)}   (negative = cash was overstated)`);
    console.log(`  corrections land in: ${[...new Set(plan.map((p) => p.target))].sort().join(', ')}`);
    if (skip.noOpenPeriod) console.log(`  ⚠ ${skip.noOpenPeriod} skipped — no open period to correct into (reopen one, then re-run)`);
    if (skip.noJournalNotSettlement) console.log(`  ${skip.noJournalNotSettlement} commerce rows have no journal at all → run backfill-journals.js first`);

    if (!COMMIT) {
        console.log('\nDry-run only. Re-run with --commit to write.\n');
        process.exit(0);
    }

    let reversed = 0;
    let posted = 0;
    for (let i = 0; i < plan.length; i += CHUNK) {
        const batch = db.batch();
        for (const p of plan.slice(i, i + CHUNK)) {
            if (p.reversal) {
                const rRef = base.collection('journals').doc();
                batch.set(rRef, {
                    ...p.reversal, entity_id: WORKSPACE,
                    posted_by: 'system:commerce-clearing-backfill',
                    posted_at: FieldValue.serverTimestamp(), created_at: FieldValue.serverTimestamp()
                });
                // Link the original so the register shows it as reversed, not stale.
                batch.set(base.collection('journals').doc(p.existingId), { reversed_by_journal_id: rRef.id }, { merge: true });
                (p.reversal.lines || []).forEach((l) => applyBalance(batch, base, p.reversal.period_key, l));
                reversed += 1;
            }
            const jRef = base.collection('journals').doc();
            batch.set(jRef, {
                ...p.repost, entity_id: WORKSPACE,
                posted_by: 'system:commerce-clearing-backfill',
                posted_at: FieldValue.serverTimestamp(), created_at: FieldValue.serverTimestamp()
            });
            (p.repost.lines || []).forEach((l) => applyBalance(batch, base, p.repost.period_key, l));
            batch.set(p.ref, { journal_ref: jRef.id, accounting_status: 'posted' }, { merge: true });
            posted += 1;
        }
        await batch.commit();
        console.log(`  committed ${Math.min(i + CHUNK, plan.length)}/${plan.length}`);
    }

    console.log(`\nDone. ${reversed} reversal(s), ${posted} repost(s).`);
    console.log('Next, in order:');
    console.log(`  node scripts/backfill-journal-numbers.js --workspace ${WORKSPACE} --commit`);
    console.log(`  node scripts/reconcile-ledger-balances.js --workspace ${WORKSPACE} --commit`);
    console.log(`  node scripts/ledger-assert-report.js --workspace ${WORKSPACE}\n`);
    process.exit(0);
}

function applyBalance(batch, base, periodKey, line) {
    batch.set(base.collection('ledger_balances').doc(`${periodKey}__${line.account_code}`), {
        period_key: periodKey, account_code: line.account_code, account_type: line.account_type,
        entity_id: WORKSPACE, currency: 'IDR',
        debit_total: FieldValue.increment(toInt(line.debit)),
        credit_total: FieldValue.increment(toInt(line.credit)),
        updated_at: FieldValue.serverTimestamp()
    }, { merge: true });
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
