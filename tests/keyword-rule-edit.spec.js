// @ts-check
const { test, expect } = require('@playwright/test');

// Keyword-rule editing (Accounting Center → Account Mapping tab): add a rule, edit
// it in place to a different account, and confirm the change persists (the drawer
// suggestion now resolves to the edited account). A "matches N recent" preview
// shows while typing. Real Firestore + deployed rules; archives the rule after.

test('Keyword rule can be edited in place and the change persists', async ({ page }) => {
    const token = `kwedit${Date.now()}`;
    const vendorWithKeyword = `Trip ${token} co`;

    await page.goto('/accounting.html');
    // The mapping tab + keyword form render on load once data resolves.
    await page.locator('[data-acct-tab="mapping"]').click();
    await expect.poll(async () => page.$$eval('#kw-rule-account option', (os) => os.length), { timeout: 30000 }).toBeGreaterThan(1);

    // Add a rule: keyword → 6440. The match preview appears while typing.
    await page.fill('#kw-rule-input', token);
    await expect(page.locator('#kw-rule-match')).toContainText(/Matches \d+ of your last/i, { timeout: 10000 });
    await page.selectOption('#kw-rule-account', '6440');
    await page.click('#kw-rule-add');

    const row = page.locator('#keyword-rules-list .acct-row').filter({ hasText: token });
    await expect(row).toContainText('6440', { timeout: 10000 });

    // Edit in place → the form loads the rule and the button flips to "Update rule".
    await row.locator('[data-kw-edit]').click();
    await expect(page.locator('#kw-rule-input')).toHaveValue(token);
    await expect(page.locator('#kw-rule-add')).toHaveText('Update rule');

    // Change the account to 6420 and update.
    await page.selectOption('#kw-rule-account', '6420');
    await page.click('#kw-rule-add');
    await expect(page.locator('#keyword-rules-list .acct-row').filter({ hasText: token })).toContainText('6420', { timeout: 10000 });

    // The edit persisted: the suggestion for a matching vendor now resolves to 6420.
    const r = await page.evaluate(async ({ vendor }) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        const wsId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || uid;
        const sug = await ds.suggestAccountForEntry(wsId, { type: 'expense', category: 'Operations', vendor_name: vendor });
        return { code: sug.code, source: sug.source };
    }, { vendor: vendorWithKeyword });
    expect(r.code).toBe('6420');
    expect(r.source).toBe('keyword');

    // Clean up.
    await page.evaluate(async (tok) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        const wsId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || uid;
        await ds.archiveKeywordAccountRule(wsId, tok);
    }, token);
});
