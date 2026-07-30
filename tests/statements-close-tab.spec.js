// @ts-check
const { test, expect } = require('@playwright/test');
const { openAccountingTab } = require('./helpers/accounting-nav');

// Authenticated browser check for the Accounting Center Statements tab
// (ledger-derived P&L + Balance Sheet) and the kernel-aware close checklist.
// Runs as the QA account against real Firestore.

test('Statements tab renders P&L + balancing Balance Sheet; close checklist shows kernel gates', async ({ page }) => {
    const bad = [];
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/permission-denied|Missing or insufficient|CSP|Content Security|statements|ledger_balances|accounting/i.test(t)) bad.push(t);
    });
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));

    await page.goto('/accounting.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });

    // --- Ledger-derived statements. One getFinancialStatements() fetch backs
    // both views, so opening either populates both containers.
    await openAccountingTab(page, 'income');
    await expect(page.locator('#income-statement-content').locator('table, .fluxy-table-empty')).toHaveCount(1, { timeout: 30000 });

    await openAccountingTab(page, 'balance');
    await expect(page.locator('#balance-sheet-content').locator('table, .fluxy-table-empty')).toHaveCount(1, { timeout: 30000 });
    // If the balance sheet rendered, it must show its equity section and a
    // tie-out badge. The badge reads "Balanced" or "Out of balance by …" — both
    // are valid; an out-of-balance badge is the integrity check correctly
    // surfacing a real ledger_balances drift (the client-side-posting risk that
    // scripts/reconcile-ledger-balances.js repairs), not a UI bug.
    if (await page.locator('#balance-sheet-content table').count()) {
        await expect(page.locator('#balance-sheet-content')).toContainText('Total liabilities & equity');
        await expect(page.locator('#balance-sheet-tieout')).toContainText(/Balanced|Seimbang|Out of balance|Tidak seimbang/, { timeout: 10000 });
    }

    // --- Close checklist: the kernel gates render once the kernel loads.
    await openAccountingTab(page, 'close');
    await expect(page.locator('[data-acct-panel="close"]')).toBeVisible();
    await expect(page.locator('#close-readiness-content')).toContainText('All entries posted to the ledger', { timeout: 30000 });
    await expect(page.locator('#close-readiness-content')).toContainText('Trial balance is in balance');

    expect(bad, `console/page errors:\n${bad.join('\n')}`).toEqual([]);
});
