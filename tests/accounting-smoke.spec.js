// @ts-check
const { test, expect } = require('@playwright/test');

// Authenticated browser smoke for the Accounting Center kernel surfaces. Runs as
// the QA Firebase account against real Firestore (new rules must be deployed).
// Verifies: the page boots, the Chart of Accounts seed write succeeds through the
// new rules, the four ledger tabs render, the trial balance flag appears, and the
// console is free of CSP / permission-denied / our-module errors.

test('Accounting Center kernel surfaces load and seed without errors', async ({ page }) => {
    const bad = [];
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        // Ignore unrelated third-party noise; flag anything touching our work or
        // Firebase permission failures.
        if (/permission-denied|Missing or insufficient|CSP|Content Security|accounting|journal|ledger|chart_of_accounts|periods/i.test(t)) bad.push(t);
    });
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));

    await page.goto('/accounting.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    // Income statement (existing surface) renders the content shell.
    await expect(page.locator('[data-acct-panel="income"]')).toBeVisible({ timeout: 30000 });

    // Chart of Accounts: seed write + read through the new rules.
    await page.locator('[data-acct-tab="coa"]').click();
    await expect(page.locator('[data-acct-panel="coa"]')).toBeVisible();
    // The starter chart has 13 accounts; wait for at least the core ones to render.
    await expect(page.locator('#coa-content')).toContainText('Cash & Bank', { timeout: 30000 });
    await expect(page.locator('#coa-content')).toContainText('Retained Earnings');
    const coaRows = await page.locator('#coa-content tbody tr').count();
    expect(coaRows).toBeGreaterThanOrEqual(13);

    // Trial Balance: balance flag must render (in/out of balance).
    await page.locator('[data-acct-tab="trial"]').click();
    await expect(page.locator('[data-acct-panel="trial"]')).toBeVisible();
    await expect(page.locator('#trial-balance-flag')).not.toHaveText('—', { timeout: 30000 });

    // Journals + General Ledger panels render (table or empty-state, never an error).
    await page.locator('[data-acct-tab="journals"]').click();
    await expect(page.locator('#journals-content')).not.toBeEmpty();
    await page.locator('[data-acct-tab="ledger"]').click();
    await expect(page.locator('#ledger-content')).not.toBeEmpty();

    // Close panel reflects period state (button present, status text set).
    await page.locator('[data-acct-tab="close"]').click();
    await expect(page.locator('#close-period-btn')).toBeVisible();

    expect(bad, `console/page errors:\n${bad.join('\n')}`).toEqual([]);
});
