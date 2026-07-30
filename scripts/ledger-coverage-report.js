// =============================================================================
// FluxyOS — Ledger coverage report (read-only)
//
// How much of each workspace's transaction population actually reached the
// double-entry ledger? This is the authoritative measurement for the ledger
// backfill (docs/LEDGER_BACKFILL_RUNBOOK.md) — run it BEFORE and AFTER
// scripts/backfill-journals.js.
//
// Admin-side on purpose. The in-app equivalent
// (tests/accounting-ledger-coverage.spec.js) reads journals through
// DataService.listJournals, which caps at `max` and filters period CLIENT-SIDE —
// it silently under-counts on workspaces with more journals than the cap. This
// script reads every journal directly, so its numbers are trustworthy.
//
// A transaction counts as posted using the SAME guard backfill-journals.js uses:
// a journal points at it, OR it carries accounting_status:'posted' / journal_ref.
// Only types the posting engine actually posts are counted as "postable"
// (transfers/adjustments/custom correctly never post).
//
// NEVER writes. There is no --commit flag.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/ledger-coverage-report.js
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/ledger-coverage-report.js --workspace <wsId>
// =============================================================================

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const ONLY_WS = flag('workspace', null);

if (admin.apps.length === 0) {
    admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {});
}
const db = admin.firestore();

// Mirrors selectRule() in assets/js/accounting-engine.js.
const POSTABLE_TYPES = new Set([
    'income', 'revenue', 'refund', 'expense', 'fee', 'tax',
    'pending_receivable', 'pending_payable'
]);
const rp = (n) => 'Rp' + (Number(n) || 0).toLocaleString('id-ID');

async function coverageFor(wsId, name) {
    const base = db.collection('workspaces').doc(wsId);
    const [txSnap, jSnap] = await Promise.all([
        base.collection('transactions').get(),
        base.collection('journals').get()
    ]);

    const journalBySource = new Set();
    jSnap.forEach((d) => {
        const s = d.data().source;
        if (s && s.collection === 'transactions' && s.id) journalBySource.add(s.id);
    });

    let postable = 0, unposted = 0, unpostedValue = 0, flaggedNoJournal = 0;
    const unpostedByPeriod = {};
    txSnap.forEach((d) => {
        const t = d.data();
        if (!POSTABLE_TYPES.has(String(t.type || '').toLowerCase())) return;
        postable++;
        const hasJournal = journalBySource.has(d.id);
        const flagged = t.accounting_status === 'posted' || !!t.journal_ref;
        // Flagged but no journal: the backfill SKIPS these, yet the ledger lacks
        // the entry. Non-zero means the backfill alone will not close the gap.
        if (flagged && !hasJournal) flaggedNoJournal++;
        if (!hasJournal && !flagged) {
            unposted++;
            unpostedValue += Number(t.amount || 0);
            const pk = periodOf(t);
            unpostedByPeriod[pk] = (unpostedByPeriod[pk] || 0) + 1;
        }
    });

    return {
        wsId, name, postable, unposted, unpostedValue, flaggedNoJournal,
        journals: jSnap.size,
        covered: postable ? Math.round(((postable - unposted) / postable) * 1000) / 10 : 100,
        unpostedByPeriod
    };
}

// Transaction dates are stored inconsistently (day-key string or Timestamp).
function periodOf(t) {
    const raw = t.date || t.timestamp || t.created_at || null;
    if (!raw) return 'unknown';
    if (typeof raw === 'string') return raw.slice(0, 7) || 'unknown';
    if (typeof raw.toDate === 'function') {
        const d = raw.toDate();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    return 'unknown';
}

async function main() {
    const wsIds = ONLY_WS
        ? [ONLY_WS]
        : (await db.collection('workspaces').get()).docs.map((d) => d.id);

    const rows = [];
    for (const id of wsIds) {
        const doc = await db.collection('workspaces').doc(id).get();
        const r = await coverageFor(id, doc.data()?.name || '?');
        if (r.postable) rows.push(r);
    }
    rows.sort((a, b) => b.unposted - a.unposted);

    console.log('\nworkspace                     name                        postable  unposted  covered   unposted value');
    rows.forEach((r) => console.log(
        `${r.wsId}  ${String(r.name).slice(0, 26).padEnd(26)} ${String(r.postable).padStart(8)} ` +
        `${String(r.unposted).padStart(9)} ${String(r.covered + '%').padStart(7)}   ${rp(r.unpostedValue)}`
    ));

    const T = rows.reduce((a, r) => ({
        p: a.p + r.postable, u: a.u + r.unposted, v: a.v + r.unpostedValue, f: a.f + r.flaggedNoJournal
    }), { p: 0, u: 0, v: 0, f: 0 });

    console.log(`\nTOTAL postable=${T.p}  unposted=${T.u} (${T.p ? Math.round((T.u / T.p) * 1000) / 10 : 0}% missing)  value=${rp(T.v)}`);
    console.log(`workspaces with a gap: ${rows.filter((r) => r.unposted > 0).length} of ${rows.length} holding transactions`);

    if (T.f > 0) {
        console.log(`\n⚠️  ${T.f} transactions are FLAGGED posted but have NO journal.`);
        console.log('    backfill-journals.js SKIPS these (its guard trusts the flag), so the');
        console.log('    backfill alone will NOT close the gap for them. Investigate before cutover.');
    } else {
        console.log('\nok  no transactions are flagged-posted-without-journal (the backfill can see every gap).');
    }

    const worst = rows.filter((r) => r.unposted > 0).slice(0, 3);
    if (worst.length) {
        console.log('\nUnposted by period (worst workspaces):');
        worst.forEach((r) => {
            const top = Object.entries(r.unpostedByPeriod).sort((a, b) => b[1] - a[1]).slice(0, 6);
            console.log(`  ${String(r.name).slice(0, 24).padEnd(24)} ${top.map(([p, n]) => `${p}:${n}`).join('  ')}`);
        });
    }
    console.log('');
}

main().then(() => process.exit(0)).catch((err) => { console.error('FATAL', err); process.exit(1); });
