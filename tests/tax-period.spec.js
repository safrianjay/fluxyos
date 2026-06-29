// @ts-check
const { test, expect } = require('@playwright/test');

// Phase 3: tax period compute + file. The UI computes the current month from the
// ledger (status → Computed); the lifecycle (compute → file → locked-from-recompute)
// is exercised via the API on a synthetic period key so re-runs never lock the real
// current month. Real Firestore + deployed rules.

test('tax period: compute current month in the UI; compute→file→lock lifecycle', async ({ page }) => {
    await page.goto('/tax-center.html');
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });

    // Ensure PKP so the period has tax data, then compute the current month via the UI.
    await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const ds = new DataService(app);
        await ds.saveTaxProfile(getAuth(app).currentUser.uid, { pkp_status: 'pkp', default_ppn_rate: 11 });
    });
    await page.reload();
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });

    await page.locator('#period-compute-btn').click();
    await expect(page.locator('#period-status-badge')).toHaveText('Computed', { timeout: 20000 });
    const curKey = await page.evaluate(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).slice(0, 7));
    await expect(page.locator('#tax-periods-list')).toContainText(curKey);

    // Full lifecycle on a synthetic key (unique per run; never the real month).
    const res = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        const k = String(2100 + (Date.now() % 5000)) + '-01';
        const c = await ds.computeTaxPeriod(uid, k);
        await ds.fileTaxPeriod(uid, k);
        const after = await ds.getTaxPeriod(uid, k);
        let recomputeThrew = false;
        try { await ds.computeTaxPeriod(uid, k); } catch (_) { recomputeThrew = true; }
        // Filing record for the period.
        const filing = await ds.addTaxFiling(uid, { periodKey: k, filing_type: 'SPT_PPN', reference_number: 'REF-' + k });
        const filings = await ds.listTaxFilings(uid, { periodKey: k });
        return {
            computedStatus: c.status, filedStatus: after.status, recomputeThrew,
            filingStatus: filing.status, filingFound: filings.some((f) => f.reference_number === 'REF-' + k && f.filing_type === 'SPT_PPN')
        };
    });
    expect(res.computedStatus).toBe('computed');
    expect(res.filedStatus).toBe('filed');
    expect(res.recomputeThrew).toBe(true);
    expect(res.filingStatus).toBe('filed');
    expect(res.filingFound).toBe(true);
});
