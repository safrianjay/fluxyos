// @ts-check
const { test, expect } = require('@playwright/test');
const { openAccountingTab } = require('./helpers/accounting-nav');

// Authenticated browser check for the Account Detail page
// (accounting-account.html + accounting-account.js), reached from the
// Accounting Center → Chart of Accounts tab by clicking an account name.
// Runs as the QA account against real Firestore.

const badConsole = (page) => {
    const bad = [];
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/permission-denied|Missing or insufficient|CSP|Content Security|404|getAccountDetail|accounting-account/i.test(t)) bad.push(t);
    });
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));
    return bad;
};

test('CoA account name links to Account Detail; page renders summary + history without errors', async ({ page }) => {
    const bad = badConsole(page);

    // Open Accounting Center and switch to the Chart of Accounts tab.
    await page.goto('/accounting.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await openAccountingTab(page, 'coa');

    // Account names are links into the detail page.
    const firstLink = page.locator('#coa-content a.acct-link').first();
    await expect(firstLink).toBeVisible({ timeout: 15000 });
    const href = await firstLink.getAttribute('href');
    expect(href).toMatch(/\/accounting-account\?code=/);
    const code = new URL(href, 'http://x').searchParams.get('code');

    await firstLink.click();

    // Detail page: content resolves (not stuck on loader / error).
    await expect(page.locator('#account-content')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#account-error')).toBeHidden();
    await expect(page.locator('#account-title')).toContainText(code || '');

    // Summary band + transaction-history section render.
    await expect(page.locator('#account-detail-body')).toContainText('Current balance');
    await expect(page.locator('#account-detail-body')).toContainText('Transaction history');

    // Breadcrumb renders at the TOP of the content, above the filter section
    // (design rule: breadcrumb → filters → data).
    const crumb = page.locator('#account-breadcrumb');
    await expect(crumb).toContainText('Chart of Accounts');
    const crumbBox = await crumb.boundingBox();
    const filtersBox = await page.locator('#account-filter-search').boundingBox();
    expect(crumbBox.y).toBeLessThan(filtersBox.y);

    // Filters + pager controls exist.
    await expect(page.locator('#account-filter-source')).toBeVisible();
    await expect(page.locator('#account-export')).toBeVisible();

    expect(bad, `console/page errors: ${bad.join(' | ')}`).toHaveLength(0);
});

test('Account Detail deep-link by ?code= renders directly, and a bad code shows the not-found state', async ({ page }) => {
    const bad = badConsole(page);

    // A seeded system account (Cash 1000) always exists.
    await page.goto('/accounting-account?code=1000');
    await expect(page.locator('#account-content')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#account-title')).toContainText('1000');
    // System accounts surface the System indicator.
    await expect(page.locator('#account-detail-body')).toContainText('System');

    // A non-existent code resolves to the friendly error state (no crash).
    await page.goto('/accounting-account?code=ZZZZ');
    await expect(page.locator('#account-error')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#account-content')).toBeHidden();

    expect(bad, `console/page errors: ${bad.join(' | ')}`).toHaveLength(0);
});
