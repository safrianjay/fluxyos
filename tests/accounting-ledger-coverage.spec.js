// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Ledger coverage + statement integrity report.
 *
 * Two jobs:
 *   1. GUARD (asserts) — the ledger-derived Income Statement must always equal the
 *      net income implied by the Trial Balance. Both read `ledger_balances`, so any
 *      drift here is a real engine or data-integrity failure.
 *   2. DIAGNOSTIC (logs) — how much of the transaction population actually reached
 *      the ledger. Run this BEFORE and AFTER `scripts/backfill-journals.js` to
 *      measure what the backfill closed. See docs/LEDGER_BACKFILL_RUNBOOK.md.
 *
 * Read-only. Runs as the QA account against real Firestore.
 */

test('ledger coverage report + Income Statement ties to Trial Balance', async ({ page }) => {
    test.setTimeout(180000);
    await page.goto('/accounting.html');
    await page.waitForSelector('#sidebar', { timeout: 30000 });
    await page.waitForSelector('#accounting-content:not(.hidden)', { timeout: 60000 });

    const out = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);

        const now = new Date();
        const dk = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
        const startKey = dk(new Date(now.getFullYear(), now.getMonth(), 1));
        const endKey = dk(new Date(now.getFullYear(), now.getMonth() + 1, 0));
        const pk = startKey.slice(0, 7);

        const [txs, journals, statements, trial] = await Promise.all([
            ds.getTransactionsForPeriod(uid, startKey, endKey).catch(() => []),
            ds.listJournals(uid, { periodKey: pk }).catch(() => []),
            ds.getFinancialStatements(uid, { startPeriod: pk, endPeriod: pk }),
            ds.getTrialBalance(uid, { periodKey: pk })
        ]);
        const jrows = Array.isArray(journals) ? journals : (journals.rows || journals.journals || []);

        const postedTxIds = new Set();
        jrows.forEach((j) => {
            if (j.source?.collection === 'transactions' && j.source?.id) postedTxIds.add(j.source.id);
        });

        // Only types the posting engine actually posts count as "should be posted";
        // transfers/adjustments are correctly absent from the ledger.
        const POSTABLE = new Set(['income', 'revenue', 'refund', 'expense', 'fee', 'tax', 'pending_receivable', 'pending_payable']);
        const postable = txs.filter(t => POSTABLE.has(String(t.type || '').toLowerCase()));
        const unposted = postable.filter(t => !postedTxIds.has(t.id));

        let revSigned = 0, expSigned = 0;
        (trial.rows || []).forEach((r) => {
            const d = Number(r.debit_total || 0), c = Number(r.credit_total || 0);
            if (r.account_type === 'revenue') revSigned += (c - d);
            if (r.account_type === 'expense') expSigned += (d - c);
        });

        return {
            period: pk,
            txTotal: txs.length,
            postableCount: postable.length,
            unpostedCount: unposted.length,
            unpostedValue: unposted.reduce((s, t) => s + Number(t.amount || 0), 0),
            journalsMissingNumber: jrows.filter(j => !j.journal_number).length,
            journalCount: jrows.length,
            isNetIncome: statements.incomeStatement.netIncome,
            tbImpliedNetIncome: revSigned - expSigned,
            tbBalanced: trial.balanced,
            bsBalanced: statements.balanceSheet.balanced,
            bsTieOut: statements.balanceSheet.tieOutDelta
        };
    });

    const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
    const covered = out.postableCount ? Math.round(((out.postableCount - out.unpostedCount) / out.postableCount) * 1000) / 10 : 100;
    console.log('\n===== LEDGER COVERAGE =====');
    console.log(`period=${out.period}  transactions=${out.txTotal}  postable=${out.postableCount}  journals=${out.journalCount}`);
    console.log(`posted to ledger: ${out.postableCount - out.unpostedCount}/${out.postableCount}  (${covered}%)`);
    console.log(`UNPOSTED: ${out.unpostedCount} txns worth ${rp(out.unpostedValue)}`);
    console.log(`journals missing journal_number: ${out.journalsMissingNumber}`);
    console.log(`trial balance balanced=${out.tbBalanced}`);
    console.log(`balance sheet balanced=${out.bsBalanced} tieOut=${rp(out.bsTieOut)}`);
    console.log('===== END =====\n');

    // The one hard invariant: both sides read ledger_balances, so they must agree
    // regardless of how much of the transaction population reached the ledger.
    expect(out.isNetIncome, 'Income Statement net income must equal Trial Balance implied net income')
        .toBe(out.tbImpliedNetIncome);
    expect(out.tbBalanced, 'Trial Balance must be in balance').toBe(true);
});
