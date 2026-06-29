// @ts-check
const { test, expect } = require('@playwright/test');

// End-to-end: a tax mapping created in the UI makes a transaction in that category
// post PPN through the real accounting kernel. Runs as the QA account against real
// Firestore with deployed rules. Sets a PKP profile, adds Revenue → PPN_OUT_11, then
// posts an income transaction via DataService and asserts the journal grosses up the
// cash leg and credits 2100 PPN Keluaran — proving the mapping → posting chain.

test('a UI tax mapping drives PPN posting on a matching transaction', async ({ page }) => {
    await page.goto('/tax-center.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });

    // Ensure the workspace is PKP (required for any PPN).
    await page.locator('[data-tax-tab="profile"]').click();
    await page.locator('#tax-pkp-status').selectOption('pkp').catch(() => {});
    await page.locator('#tax-ppn-rate').fill('11');
    await page.locator('#tax-profile-save').click();
    await expect(page.getByText('Tax profile saved')).toBeVisible({ timeout: 20000 });

    // Add the mapping Revenue (category) → PPN_OUT_11 via the UI.
    await page.locator('[data-tax-tab="mappings"]').click();
    await page.locator('#map-source-type').selectOption('transaction_category').catch(() => {});
    await page.locator('#map-source-value').fill('Revenue');
    await page.locator('#map-tax-code').selectOption('PPN_OUT_11').catch(() => {});
    await page.locator('#map-add-btn').click();
    await expect(page.getByText('Tax mapping saved')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#tax-mappings-list')).toContainText('Revenue', { timeout: 20000 });
    await expect(page.locator('#tax-mappings-list')).toContainText('PPN Keluaran 11%');

    // Post an income transaction in the mapped category through the real kernel and
    // read back its journal. Unique amount so the PPN is identifiable.
    const amount = 7000000 + (Date.now() % 100000);
    const expectedPpn = Math.round((amount * 11) / 100);
    const result = await page.evaluate(async (amt) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        const ref = await ds.addTransaction(uid, {
            type: 'income', category: 'Revenue', amount: amt, vendor_name: 'QA Tax Posting', status: 'Completed', icon: '💰'
        });
        const journals = await ds.listJournals(uid, { max: 25 });
        const j = journals.find((x) => x.source && x.source.id === ref.id) || null;
        return { txnId: ref.id, journal: j ? { lines: j.lines, total_debit: j.total_debit, total_credit: j.total_credit, is_balanced: j.is_balanced } : null };
    }, amount);

    expect(result.journal, 'a journal was posted for the taxed transaction').not.toBeNull();
    const j = result.journal;
    expect(j.is_balanced).toBe(true);
    expect(j.total_debit).toBe(j.total_credit);

    // PPN Keluaran (2100) credited with the computed PPN.
    const ppnLine = j.lines.find((l) => l.account_code === '2100');
    expect(ppnLine, 'journal has a 2100 PPN Keluaran line').toBeTruthy();
    expect(ppnLine.credit).toBe(expectedPpn);

    // Cash (1000) grossed up to base + PPN (base income line + the gross-up line).
    const cashDebit = j.lines.filter((l) => l.account_code === '1000').reduce((s, l) => s + (Number(l.debit) || 0), 0);
    expect(cashDebit).toBe(amount + expectedPpn);

    // Revenue (4000) stays at the base (tax-exclusive).
    const revCredit = j.lines.filter((l) => l.account_code === '4000').reduce((s, l) => s + (Number(l.credit) || 0), 0);
    expect(revCredit).toBe(amount);
});
