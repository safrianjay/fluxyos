// @ts-check
const { test, expect } = require('@playwright/test');

// Phase 4: annual corporate tax (PPh 29) reconciliation. Ordinary scheme = 22% CIT on
// taxable income, less prepayments, remainder to 2200. Seeds income in a synthetic
// fiscal year (so re-runs never collide with the real year), computes + posts, and
// verifies the journal + idempotency. Plus a UI compute check on the current year.

test('annual corporate tax: compute, post (Dr 6500 / Cr 2200), and idempotency', async ({ page }) => {
    await page.goto('/tax-center.html');
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });

    const res = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        await ds.saveTaxProfile(uid, { pkp_status: 'pkp', default_ppn_rate: 11, umkm_final: false });
        const yr = String(2100 + (Date.now() % 800));
        await ds.addTransaction(uid, {
            type: 'income', category: 'Revenue', amount: 100000000, vendor_name: 'QA Annual',
            status: 'Completed', icon: '💰', timestamp: new Date(yr + '-06-15T00:00:00')
        });
        const preview = await ds.computeAnnualCorporateTax(uid, yr, { fiscalAdjustment: 0 });
        const posted = await ds.postAnnualCorporateTax(uid, yr, { fiscalAdjustment: 0 });
        const j = await ds.getJournalById(uid, posted.journal_ref);
        let reThrew = false;
        try { await ds.postAnnualCorporateTax(uid, yr, {}); } catch (_) { reThrew = true; }
        const sum = (code, side) => (j.lines || []).filter((l) => l.account_code === code).reduce((s, l) => s + (Number(l[side]) || 0), 0);
        return { scheme: preview.scheme, cit: preview.cit, pph29: preview.pph29, d6500: sum('6500', 'debit'), c2200: sum('2200', 'credit'), balanced: j.is_balanced, reThrew };
    });

    expect(res.scheme).toBe('ordinary');
    expect(res.cit).toBe(22000000);     // 22% of 100,000,000
    expect(res.pph29).toBe(22000000);   // no prepayments in the synthetic year
    expect(res.d6500).toBe(22000000);   // Dr Tax Expense (CIT)
    expect(res.c2200).toBe(22000000);   // Cr PPh 29 Payable
    expect(res.balanced).toBe(true);
    expect(res.reThrew).toBe(true);     // idempotent: second post refused

    // UI compute (current year) renders a result.
    await page.locator('[data-tax-tab="corporate"]').click();
    await page.locator('#corp-annual-compute').click();
    await expect(page.locator('#corp-annual-result')).toContainText('Corporate tax (CIT)', { timeout: 20000 });
});
