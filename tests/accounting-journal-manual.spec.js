// @ts-check
const { test, expect } = require('@playwright/test');
const { openAccountingTab } = require('./helpers/accounting-nav');

// Authenticated browser smoke for the Journal Number / Manual Journal / Journal
// Detail surfaces. Runs as the QA Firebase account against real Firestore (new
// rules must be deployed). Verifies: the manual editor loads console-clean, a
// balanced draft posts and is assigned a JE-YYYY-NNNNNN number, the Journal Detail
// page renders that number, and the redesigned register shows the Journal # column.

const consoleGuard = (page, bad) => {
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/permission-denied|Missing or insufficient|CSP|Content Security|accounting|journal|ledger|chart_of_accounts|counters|periods/i.test(t)) bad.push(t);
    });
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));
};

test('manual journal: draft posts with a JE number and opens in Journal Detail', async ({ page }) => {
    const bad = [];
    consoleGuard(page, bad);

    await page.goto('/accounting-journal-new.html');
    await expect(page.locator('#mj-form')).toBeVisible({ timeout: 30000 });
    // Number is system-owned and not editable before posting.
    await expect(page.locator('#mj-number')).toHaveText('Auto-generated on post');

    await page.locator('#mj-description').fill('QA manual journal — automated smoke');
    // Two default lines: accrue an expense against a liability, balanced. Cash is
    // deliberately NOT available here — 1000 is closed to manual journals so every
    // cash movement keeps a reconcilable statement counterpart. An accrual is what
    // this workflow is actually for.
    const rows = page.locator('#mj-lines tr');
    await expect(rows).toHaveCount(2);
    await rows.nth(0).locator('.mj-acct').selectOption('6400');
    await rows.nth(0).locator('.mj-debit').fill('1000');
    await rows.nth(1).locator('.mj-acct').selectOption('2500');
    await rows.nth(1).locator('.mj-credit').fill('1000');

    // Balance flag flips to ready and Post enables.
    await expect(page.locator('#mj-balance-flag')).toContainText('In balance', { timeout: 10000 });
    await expect(page.locator('#mj-post')).toBeEnabled();

    await page.locator('#mj-post').click();

    // Posting redirects to the read-only Journal Detail page with the new number.
    await page.waitForURL(/accounting-journal\.html\?id=/, { timeout: 30000 });
    await expect(page.locator('#journal-content')).toContainText(/JE-\d{4}-\d{6}/, { timeout: 30000 });
    await expect(page.locator('#journal-content')).toContainText('Posted');
    await expect(page.locator('#journal-content')).toContainText('Manual');

    expect(bad, `console/page errors:\n${bad.join('\n')}`).toEqual([]);
});

test('journal register shows the redesigned columns and journal numbers', async ({ page }) => {
    const bad = [];
    consoleGuard(page, bad);

    await page.goto('/accounting.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await openAccountingTab(page, 'journals');
    await expect(page.locator('#journals-content')).not.toBeEmpty({ timeout: 30000 });

    // Redesigned header columns are present; the old Dr/Cr column is gone.
    const head = page.locator('#journals-content thead');
    await expect(head).toContainText('Journal #');
    await expect(head).toContainText('Description');
    await expect(head).not.toContainText('Posting (Dr');

    // At least one posted journal carries a JE number (the manual one above, plus
    // any system postings in the current period).
    await expect(page.locator('#journals-content tbody')).toContainText(/JE-\d{4}-\d{6}/, { timeout: 30000 });

    // Filter toolbar is wired.
    await expect(page.locator('#journals-filter-search')).toBeVisible();
    await expect(page.locator('#journals-filter-status')).toBeVisible();

    expect(bad, `console/page errors:\n${bad.join('\n')}`).toEqual([]);
});

test('general ledger "All accounts" renders one section per account', async ({ page }) => {
    const bad = [];
    consoleGuard(page, bad);

    await page.goto('/accounting.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await openAccountingTab(page, 'ledger');
    await expect(page.locator('#ledger-content')).not.toBeEmpty({ timeout: 30000 });

    // The selector offers an "All accounts" option.
    await expect(page.locator('#ledger-account-select option[value="__all__"]')).toHaveCount(1);

    // Select it the way the enhanced dropdown does (value + a real change event).
    await page.evaluate(() => {
        const sel = document.getElementById('ledger-account-select');
        sel.value = '__all__';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Multiple per-account sections render, each with a header + closing balance.
    await expect(page.locator('#ledger-content .acct-gl-section').first()).toBeVisible({ timeout: 30000 });
    expect(await page.locator('#ledger-content .acct-gl-section').count()).toBeGreaterThan(1);
    await expect(page.locator('#ledger-content')).toContainText('Closing balance');

    expect(bad, `console/page errors:\n${bad.join('\n')}`).toEqual([]);
});

test('reversing a reversal is refused', async ({ page }) => {
    // A reversal already neutralises its original. Reversing it re-APPLIES the
    // entry, which on a control account is silent corruption — this is what left a
    // production workspace with a negative Accounts Receivable balance, off by
    // exactly the re-applied amount, while the aging report still looked fine.
    await page.goto('/accounting.html');
    await page.waitForSelector('#accounting-content:not(.hidden)', { timeout: 60000 });

    const out = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js?v=' + Date.now())).default;
        const app = getApps()[0];
        const ds = new DataService(app);
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((r) => {
            const stop = onAuthStateChanged(auth, (u) => { if (u) { stop(); r(u); } });
            setTimeout(() => r(null), 20000);
        });
        if (!user) return { error: 'not signed in' };
        // Stub the read so this asserts the GUARD, not a particular workspace's data.
        ds.getJournalById = async () => ({
            id: 'j1', status: 'reversal', journal_number: 'JE-2026-000123',
            period_key: '2026-08', lines: [], posting_rule_id: 'REVERSAL:INV-PAY'
        });
        try { await ds.reverseJournal(user.uid, 'j1'); return { threw: false }; }
        catch (err) { return { threw: true, code: err.code, message: String(err.message) }; }
    });

    expect(out.error).toBeUndefined();
    expect(out.threw, 'a reversal must not be reversible').toBe(true);
    expect(out.code).toBe('GL_070');
    expect(out.message).toMatch(/itself a reversal/i);
});
