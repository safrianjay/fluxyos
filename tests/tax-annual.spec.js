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
        // A provably-fresh synthetic year: prior runs seed reconciled years, and a
        // collision would make the post/save throw "already reconciled".
        let yr = null;
        for (let t = 0; t < 25 && !yr; t++) {
            const cand = String(3000 + Math.floor(Math.random() * 6999));
            if (!(await ds.getTaxPeriod(uid, cand))) yr = cand;
        }
        if (!yr) throw new Error('no fresh synthetic year found');
        await ds.addTransaction(uid, {
            type: 'income', category: 'Revenue', amount: 100000000, vendor_name: 'QA Annual',
            status: 'Completed', icon: '💰', timestamp: new Date(yr + '-06-15T00:00:00')
        });
        // Fiscal-adjustment line list: +1,000,000 non-deductible, −400,000 non-taxable
        // → net +600,000 to taxable income. Saved lines persist on the annual doc.
        const savedAdj = await ds.saveFiscalAdjustments(uid, yr, [
            { label: 'Non-deductible entertainment', amount: 1000000, kind: 'permanent' },
            { label: 'Non-taxable interest income', amount: -400000, kind: 'permanent' }
        ]);
        const loadedAdj = await ds.getFiscalAdjustments(uid, yr);
        const adjTotal = loadedAdj.reduce((s, l) => s + l.amount, 0);
        const preview = await ds.computeAnnualCorporateTax(uid, yr, { fiscalAdjustment: adjTotal });
        const posted = await ds.postAnnualCorporateTax(uid, yr, { fiscalAdjustment: adjTotal });
        const j = await ds.getJournalById(uid, posted.journal_ref);
        let reThrew = false;
        try { await ds.postAnnualCorporateTax(uid, yr, {}); } catch (_) { reThrew = true; }
        // Adjustments are locked after reconciliation, and the lines survive on the doc.
        let adjLocked = false;
        try { await ds.saveFiscalAdjustments(uid, yr, []); } catch (_) { adjLocked = true; }
        const annualDoc = await ds.getTaxPeriod(uid, yr) || {};
        const sum = (code, side) => (j.lines || []).filter((l) => l.account_code === code).reduce((s, l) => s + (Number(l[side]) || 0), 0);
        return {
            scheme: preview.scheme, taxable: preview.taxable_income, cit: preview.cit, pph29: preview.pph29,
            d6500: sum('6500', 'debit'), c2200: sum('2200', 'credit'), balanced: j.is_balanced, reThrew,
            savedCount: savedAdj.length, loadedCount: loadedAdj.length, adjTotal, adjLocked
        };
    });

    expect(res.savedCount).toBe(2);
    expect(res.loadedCount).toBe(2);
    expect(res.adjTotal).toBe(600000);   // +1,000,000 − 400,000
    expect(res.scheme).toBe('ordinary');
    expect(res.taxable).toBe(100600000); // 100,000,000 + net adjustments
    expect(res.cit).toBe(22132000);      // 22% of 100,600,000
    expect(res.pph29).toBe(22132000);    // no prepayments in the synthetic year
    expect(res.d6500).toBe(22132000);    // Dr Tax Expense (CIT)
    expect(res.c2200).toBe(22132000);    // Cr PPh 29 Payable
    expect(res.balanced).toBe(true);
    expect(res.reThrew).toBe(true);      // idempotent: second post refused
    expect(res.adjLocked).toBe(true);    // adjustments locked once reconciled

    // UI: the adjustment editor persists lines across a reload (fresh synthetic year).
    const uiYear = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        for (let t = 0; t < 25; t++) {
            const cand = String(3000 + Math.floor(Math.random() * 6999));
            if (!(await ds.getTaxPeriod(uid, cand))) return cand;
        }
        return null;
    });
    expect(uiYear).not.toBeNull();
    await page.locator('[data-tax-tab="corporate"]').click();
    await page.locator('#corp-annual-year').fill(uiYear);
    await page.locator('#corp-annual-year').dispatchEvent('change');
    await expect(page.locator('#fiscal-adj-list')).toHaveAttribute('data-loaded-year', uiYear, { timeout: 15000 });
    await page.locator('#fiscal-adj-add').click();
    await page.locator('[data-adj-row="0"] [data-adj-label]').fill('QA UI adjustment');
    await page.locator('[data-adj-row="0"] [data-adj-amount]').fill('250000');
    await page.locator('#fiscal-adj-save').click();
    await expect(page.getByText('Adjustments saved')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#fiscal-adj-total')).toHaveText('Rp250.000');
    await page.reload();
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });
    await page.locator('[data-tax-tab="corporate"]').click();
    await page.locator('#corp-annual-year').fill(uiYear);
    await page.locator('#corp-annual-year').dispatchEvent('change');
    await expect(page.locator('#fiscal-adj-list')).toHaveAttribute('data-loaded-year', uiYear, { timeout: 15000 });
    await expect(page.locator('[data-adj-row="0"] [data-adj-label]')).toHaveValue('QA UI adjustment', { timeout: 20000 });
    await expect(page.locator('#fiscal-adj-total')).toHaveText('Rp250.000');

    // UI compute (current year) renders a result.
    await page.locator('#corp-annual-year').fill(String(new Date().getFullYear()));
    await page.locator('#corp-annual-year').dispatchEvent('change');
    await page.locator('#corp-annual-compute').click();
    await expect(page.locator('#corp-annual-result')).toContainText('Corporate tax (CIT)', { timeout: 20000 });
});
