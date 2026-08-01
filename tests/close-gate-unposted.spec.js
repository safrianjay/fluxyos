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
            { id: 'h', type: 'income', amount: 70, linked_invoice_id: 'INV-1' }         // INV-PAY       -> blocking
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

    // a, b, h, b1, s1 — invoice-linked settlements block too: INV-ISSUE is wired
    // (Dr A/R / Cr Revenue on issue), so an unposted INV-PAY is an ordinary gap.
    expect(out.blocking, 'blocking count').toBe(5);
    expect(out.deferred, 'nothing is deferred any more').toBe(0);
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

test('the unposted population is actionable, not a dead end', async ({ page }) => {
    await page.goto('/accounting.html');
    await page.waitForSelector('#accounting-content:not(.hidden)', { timeout: 60000 });

    // The gate blocks on sources with no 'pending' flag, which postPendingJournals
    // cannot reach — so a dedicated remedy must exist and be wired to the same
    // enumeration the gate uses.
    const wired = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const DataService = (await import('/assets/js/db-service.js?v=' + Date.now())).default;
        const ds = new DataService(getApps()[0]);
        return {
            hasRemedy: typeof ds.postUnpostedSources === 'function',
            sharesEnumeration: typeof ds._collectUnpostedSources === 'function',
            button: !!document.getElementById('post-unposted-btn')
        };
    });
    expect(wired.hasRemedy, 'DataService.postUnpostedSources must exist').toBe(true);
    expect(wired.sharesEnumeration, 'gate and remedy must share _collectUnpostedSources').toBe(true);
    expect(wired.button, 'Close panel must expose a post action').toBe(true);
});

test('the remedy posts nothing when there is nothing unposted (idempotent)', async ({ page }) => {
    await page.goto('/accounting.html');
    await page.waitForSelector('#accounting-content:not(.hidden)', { timeout: 60000 });

    const out = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const DataService = (await import('/assets/js/db-service.js?v=' + Date.now())).default;
        const ds = new DataService(getApps()[0]);
        // No unposted sources -> must be a no-op and must not touch Firestore.
        ds.getTransactionsForPeriod = async () => [
            { id: 'a', type: 'income', accounting_status: 'posted' },
            { id: 'b', type: 'transfer' },
            { id: 'c', type: 'income', accounting_status: 'excluded' }
        ];
        ds.getBillsForPeriod = async () => [];
        ds.getSubscriptionsForPeriod = async () => [];
        let posted = false;
        ds._postCollectedSources = async () => { posted = true; return { posted: 99 }; };
        const res = await ds.postUnpostedSources('uid', '2026-07-01', '2026-07-31');
        return { res, touchedFirestore: posted };
    });
    expect(out.res.posted).toBe(0);
    expect(out.touchedFirestore, 'must short-circuit before any write path').toBe(false);
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
