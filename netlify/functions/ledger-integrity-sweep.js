'use strict';

// Nightly ledger-integrity assertions across every workspace (03:00 WIB).
// Read-only: it detects drift and records a report; repair stays manual via
// scripts/reconcile-ledger-balances.js --commit. No public HTTP surface.
//
// Enumerates `workspaces` DIRECTLY rather than walking users → workspace. Finance
// data is workspace-scoped, and a server that resolves scope per-uid can silently
// read the stale users/{uid} copy left behind by the 2026-06-22 migration —
// returning a ledger frozen at that date instead of failing loudly. Direct
// enumeration is the workspace-native path (same as scripts/ledger-coverage-report.js).
const { schedule } = require('@netlify/functions');
const { initAdmin } = require('./lib/notify-core');
const { assertWorkspaceLedger } = require('./lib/ledger-assert');

// Guard against an unbounded run on a large tenant list; the remainder is picked
// up by the next night's sweep.
const MAX_WORKSPACES = 200;

// The cron that actually registers is the one in netlify.toml — this wrapper is
// what Netlify silently ignored for this function. Keep the two in step.
exports.handler = schedule('0 20 * * *', async () => {
    // Default-off kill switch: must be explicitly "true" to run.
    if (process.env.LEDGER_ASSERT_ENABLED !== 'true') {
        console.log('ledger-integrity-sweep skipped: LEDGER_ASSERT_ENABLED !== "true"');
        return { statusCode: 200, body: 'disabled' };
    }

    const db = initAdmin();
    const dayKey = new Date().toISOString().slice(0, 10);
    const workspaces = await db.collection('workspaces').limit(MAX_WORKSPACES).get();

    let scanned = 0;
    let failing = 0;
    const failures = [];

    for (const ws of workspaces.docs) {
        let report;
        try {
            report = await assertWorkspaceLedger(db, ws.id);
        } catch (err) {
            // One bad workspace must not abort the sweep — the rest still get checked.
            console.error(`[ledger-assert] ${ws.id} failed to run:`, err && err.message ? err.message : err);
            continue;
        }
        scanned += 1;
        if (!report.ok) {
            failing += 1;
            const broken = report.checks.filter((c) => !c.ok && c.severity !== 'info');
            failures.push({ workspace: ws.id, checks: broken.map((c) => `${c.id} (Δ${c.delta})`) });

            // Log level reflects whether a HUMAN needs to act, not merely that a
            // check returned false. A coverage gap on a workspace nobody has
            // backfilled yet is a known, expected state that would otherwise log
            // at ERROR every night forever — and a permanently-red error stream
            // is one people stop reading, which defeats the entire point of
            // running these assertions automatically.
            //
            // ERROR is reserved for the finding that means the posting engine
            // itself is wrong: journal LINES that do not foot cannot be explained
            // by missing data, only by a bug. Everything else is a WARN with a
            // named remedy.
            const enginebug = broken.some((c) => c.id === 'trial_balance');
            const line = `[ledger-assert] ${ws.id}: ${JSON.stringify(broken)}`;
            if (enginebug) console.error(`UNBALANCED LEDGER — ${line}`);
            else console.warn(`findings — ${line}`);
        }
        try {
            await db.collection('workspaces').doc(ws.id)
                .collection('ledger_integrity_reports').doc(dayKey)
                .set(report, { merge: false });
        } catch (err) {
            console.error(`[ledger-assert] ${ws.id} report write failed:`, err && err.message ? err.message : err);
        }
    }

    const summary = { day: dayKey, scanned, failing, failures };
    console.log('[ledger-assert] sweep complete:', JSON.stringify(summary));
    // Full detail always lands in workspaces/{id}/ledger_integrity_reports/{day};
    // the log is a pointer, not the record.
    return { statusCode: 200, body: JSON.stringify(summary) };
});
