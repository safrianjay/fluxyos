// @ts-check
const { test, expect } = require('@playwright/test');

// Phase 4: corporate tax (PPh 25 installment). Recording a PPh 25 payment posts a
// creditable prepayment: Dr 1140 Prepaid PPh 25 / Cr 1000 Cash (not tax expense).
// Drives the Corporate Tax tab record action, then verifies the journal + KPI. Real
// Firestore + deployed rules.

test('recording a PPh 25 installment posts to Prepaid PPh 25 (1140)', async ({ page }) => {
    await page.goto('/tax-center.html');
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });

    await page.locator('[data-tax-tab="corporate"]').click();
    await expect(page.locator('[data-tax-panel="corporate"]')).toBeVisible();

    const amount = 1000000 + (Date.now() % 100000);
    await page.locator('#corp-pph25-amount').fill(String(amount));
    await page.locator('#corp-pph25-btn').click();
    await expect(page.getByText('PPh 25 payment recorded')).toBeVisible({ timeout: 20000 });

    const res = await page.evaluate(async (amt) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        const js = await ds.listJournals(uid, { max: 30 });
        const j = js.find((x) => (x.lines || []).some((l) => l.account_code === '1140' && Number(l.debit) === amt)) || null;
        if (!j) return null;
        const sum = (code, side) => j.lines.filter((l) => l.account_code === code).reduce((s, l) => s + (Number(l[side]) || 0), 0);
        return { balanced: j.is_balanced, d1140: sum('1140', 'debit'), c1000: sum('1000', 'credit') };
    }, amount);

    expect(res, 'a PPh 25 journal was posted').not.toBeNull();
    expect(res.balanced).toBe(true);
    expect(res.d1140).toBe(amount);   // Dr Prepaid PPh 25
    expect(res.c1000).toBe(amount);   // Cr Cash

    // Prepaid KPI reflects accumulated installments.
    await expect(page.locator('#kpi-corp-prepaid')).toHaveText(/Rp[1-9]/, { timeout: 20000 });
});
