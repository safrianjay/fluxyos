// @ts-check
const { test, expect } = require('@playwright/test');
const { openAccountingTab } = require('./helpers/accounting-nav');

/**
 * The Close gate must detect sources that never reached the ledger.
 *
 * Regression guard for a real defect: the checklist gated on
 * countPendingPostings, which matches accounting_status == 'pending' only. A
 * source that was never queued has no accounting_status at all, so it was
 * invisible — the gate read "All entries posted to the ledger — Up to date"
 * while hundreds of transactions had never posted, and a production workspace
 * closed two periods on incomplete books that way.
 * See docs/LEDGER_BACKFILL_RUNBOOK.md.
 *
 * Exercises DataService directly (no writes) so it does not depend on the QA
 * workspace happening to contain an unposted record.
 */

test('countUnpostedSources separates blocking, deferred, and terminal states', async ({ page }) => {
    await page.goto('/accounting.html');
    await page.waitForSelector('#accounting-content:not(.hidden)', { timeout: 60000 });

    const out = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const DataService = (await import('/assets/js/db-service.js?v=' + Date.now())).default;
        const ds = new DataService(getApps()[0]);

        // Stub the period readers so the classification logic is what's under test.
        const txs = [
            { id: 'a', type: 'income', amount: 100 },                                  // never queued  -> blocking
            { id: 'b', type: 'expense', amount: 50, accounting_status: 'pending' },     // queued        -> blocking
            { id: 'c', type: 'income', amount: 10, accounting_status: 'posted' },       // done          -> ignored
            { id: 'd', type: 'expense', amount: 10, journal_ref: 'JE-1' },              // done          -> ignored
            { id: 'e', type: 'expense', amount: 10, accounting_status: 'excluded' },    // deliberate    -> ignored
            { id: 'f', type: 'transfer', amount: 999 },                                 // never posts   -> ignored
            { id: 'g', type: 'adjustment', amount: 999 },                               // never posts   -> ignored
            { id: 'h', type: 'income', amount: 70, linked_invoice_id: 'INV-1' }         // INV-PAY       -> deferred
        ];
        ds.getTransactionsForPeriod = async () => txs;
        ds.getBillsForPeriod = async () => [
            { id: 'b1' },                                    // unposted bill      -> blocking
            { id: 'b2', accounting_status: 'posted' },       // done               -> ignored
            { id: 'b3', accounting_status: 'excluded' }      // foreign currency   -> ignored
        ];
        ds.getSubscriptionsForPeriod = async () => [{ id: 's1' }]; // unposted      -> blocking

        return await ds.countUnpostedSources('uid', '2026-07-01', '2026-07-31');
    });

    // a, b, b1, s1
    expect(out.blocking, 'blocking count').toBe(4);
    // h — cannot post until INV-ISSUE is wired, so it must never block a close
    expect(out.deferred, 'deferred (invoice-linked) count').toBe(1);
    expect(out.total).toBe(5);
});

test('a never-queued source is invisible to countPendingPostings but caught here', async ({ page }) => {
    await page.goto('/accounting.html');
    await page.waitForSelector('#accounting-content:not(.hidden)', { timeout: 60000 });

    const out = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const DataService = (await import('/assets/js/db-service.js?v=' + Date.now())).default;
        const ds = new DataService(getApps()[0]);
        // The exact shape that slipped through: postable, no accounting_status.
        ds.getTransactionsForPeriod = async () => [{ id: 'x', type: 'income', amount: 4_117_460_005 }];
        ds.getBillsForPeriod = async () => [];
        ds.getSubscriptionsForPeriod = async () => [];
        return await ds.countUnpostedSources('uid', '2026-05-01', '2026-05-31');
    });

    expect(out.blocking, 'a never-queued transaction must block the close').toBe(1);
});

test('Close button is disabled while entries are unposted', async ({ page }) => {
    await page.goto('/accounting.html');
    await page.waitForSelector('#accounting-content:not(.hidden)', { timeout: 60000 });
    await openAccountingTab(page, 'close');
    await expect(page.locator('#close-readiness-content'))
        .toContainText('All entries posted to the ledger', { timeout: 30000 });

    const state = await page.evaluate(() => {
        const btn = document.getElementById('close-period-btn');
        const status = document.getElementById('close-status');
        return {
            hidden: btn?.classList.contains('hidden') ?? true,
            disabled: !!btn?.disabled,
            status: status?.textContent?.trim() || ''
        };
    });

    // If the period is already closed the button is hidden — nothing to assert.
    test.skip(state.hidden, 'period already closed in this workspace');

    // Whenever the status reports unposted entries, the button must be disabled.
    if (/not posted to the ledger/i.test(state.status)) {
        expect(state.disabled, 'Close must be disabled while entries are unposted').toBe(true);
    } else {
        expect(state.status).toMatch(/balance|No postings/i);
    }
});
