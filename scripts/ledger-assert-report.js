// =============================================================================
// FluxyOS — Ledger integrity report (read-only)
//
// The manual runner for the same assertions the nightly sweep executes
// (netlify/functions/ledger-integrity-sweep.js). Both call
// assertWorkspaceLedger() from netlify/functions/lib/ledger-assert.js, so what
// you see here is exactly what the cron will report — run this FIRST, look at
// the output, then set LEDGER_ASSERT_ENABLED=true.
//
// The five reconciliations (docs/ACCOUNTING_SPEC_REVIEW.md §10):
//   ar_subledger           GL 1100 == open invoices + pending_receivable accruals
//   ap_subledger           GL 2000 == unpaid bills + pending_payable accruals
//   trial_balance          Σdebit == Σcredit across every posted journal LINE
//                          (the check Firestore rules structurally cannot do)
//   ledger_balances_drift  stored balances == recomputed from journal lines
//   journal_coverage       every postable source produced a journal
//   bank_balance           GL 1000 vs the last bank snapshot — INFORMATIONAL,
//                          never fails (unpresented items differ by design)
//
// Expect journal_coverage to FAIL on workspaces that were never backfilled —
// that is the finding, not a bug. Fix via docs/LEDGER_BACKFILL_RUNBOOK.md.
// Expect ledger_balances_drift to point at
// scripts/reconcile-ledger-balances.js --commit.
//
// NEVER writes. There is no --commit flag; repair lives in the reconcile script
// on purpose, so a diagnostic can never mutate the ledger.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/ledger-assert-report.js
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/ledger-assert-report.js --workspace <wsId>
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/ledger-assert-report.js --json
//
// Exit code: 0 if every workspace passes, 1 if any assertion failed (so it can
// gate a cutover step in a shell pipeline).
// =============================================================================

const admin = require('firebase-admin');
const { assertWorkspaceLedger } = require('../netlify/functions/lib/ledger-assert');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const ONLY_WS = flag('workspace', null);
const AS_JSON = args.includes('--json');

if (admin.apps.length === 0) {
    admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {});
}
const db = admin.firestore();

const rp = (n) => {
    const v = Number(n) || 0;
    return (v < 0 ? '-Rp' : 'Rp') + Math.abs(v).toLocaleString('id-ID');
};

// Checks whose expected/actual are RUPIAH. The rest are counts (drifted
// accounts, unposted sources) and must not be printed as money — "Δ Rp1" for one
// missing journal reads as a one-rupiah discrepancy, which is the opposite of
// what it means. Their detail string already carries the count.
const MONEY_CHECKS = new Set(['ar_subledger', 'ap_subledger', 'trial_balance', 'bank_balance']);

// Per-check hint: what the operator should actually DO about a failure. A report
// that only says "ar_subledger: FAIL" sends people digging; naming the remedy is
// the difference between a signal and noise.
const REMEDY = {
    ar_subledger: 'A/R does not tie to the invoice subledger — usually unposted invoices (backfill) or a manual journal to 1100.',
    ap_subledger: 'A/P does not tie to the bill subledger — usually unposted bills (backfill) or a manual journal to 2000.',
    trial_balance: 'Journal LINES do not foot. This is a posting-engine bug, not a data gap — investigate before anything else.',
    ledger_balances_drift: 'Run: node scripts/reconcile-ledger-balances.js --workspace <id> --commit',
    journal_coverage: 'Sources never reached the ledger — docs/LEDGER_BACKFILL_RUNBOOK.md (backfill-journals.js).'
};

async function main() {
    const wsIds = ONLY_WS
        ? [ONLY_WS]
        : (await db.collection('workspaces').get()).docs.map((d) => d.id);

    const reports = [];
    for (const id of wsIds) {
        const nameDoc = await db.collection('workspaces').doc(id).get();
        const name = nameDoc.data()?.name || '?';
        try {
            const report = await assertWorkspaceLedger(db, id);
            reports.push({ ...report, name });
        } catch (err) {
            // One unreadable workspace must not hide the others.
            reports.push({ workspace_id: id, name, ok: false, error: err.message, checks: [] });
        }
    }

    if (AS_JSON) {
        console.log(JSON.stringify(reports, null, 2));
        return reports.every((r) => r.ok) ? 0 : 1;
    }

    // Failing workspaces first — the report is read top-down and the clean ones
    // are not what you came for.
    reports.sort((a, b) => Number(a.ok) - Number(b.ok));

    for (const r of reports) {
        const head = `${r.workspace_id}  ${String(r.name).slice(0, 30)}`;
        if (r.error) { console.log(`\n✗ ${head}\n    could not read: ${r.error}`); continue; }
        console.log(`\n${r.ok ? 'ok  ' : '✗   '}${head}`);
        for (const c of r.checks) {
            const mark = c.severity === 'info' ? 'i ' : (c.ok ? 'ok' : '✗ ');
            const delta = (c.delta && MONEY_CHECKS.has(c.id)) ? `  Δ${rp(c.delta)}` : '';
            console.log(`    ${mark} ${c.id.padEnd(22)} ${c.detail}${delta}`);
            if (!c.ok && c.severity !== 'info' && REMEDY[c.id]) {
                console.log(`       → ${REMEDY[c.id]}`);
            }
        }
    }

    const failing = reports.filter((r) => !r.ok);
    console.log(`\n${reports.length} workspace(s) checked · ${failing.length} with findings`);
    if (failing.length) {
        console.log('Findings are read-only observations. Nothing was written.');
        console.log(`Affected: ${failing.map((r) => r.name || r.workspace_id).join(', ')}`);
    } else {
        console.log('Every workspace ties out. Safe to enable LEDGER_ASSERT_ENABLED.');
    }
    console.log('');
    return failing.length ? 1 : 0;
}

main()
    .then((code) => process.exit(code))
    .catch((err) => { console.error('FATAL', err); process.exit(1); });
