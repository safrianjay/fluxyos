// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');

// Phase 3: SPT PPN + Bukti Potong CSV exports. Posts a taxed bill (input PPN + PPh
// withholding) to guarantee rows this period, then triggers each export and asserts
// the downloaded CSV has the right header + at least one data row. export.create audit
// is written. Real Firestore + deployed rules.

test('Tax Center exports SPT PPN and Bukti Potong CSVs for the period', async ({ page }) => {
    await page.goto('/tax-center.html');
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });

    // Guarantee data this period: a PKP bill with PPN + PPh 23.
    await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        await ds.saveTaxProfile(uid, { pkp_status: 'pkp', default_ppn_rate: 11 });
        await ds.addBill(uid, {
            amount: 11100000, vendor_name: 'QA Export Vendor', category: 'Infrastructure', type: 'expense',
            status: 'Completed', icon: '💸', tax_rate_percent: 11, withholding_rate: 2, withholding_type: 'PPh 23',
            withholding_code: 'PPH23', bukti_potong_no: 'EXP/PPH23/2026'
        });
    });
    await page.reload();
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });

    // SPT PPN export (PPN tab).
    await page.locator('[data-tax-tab="ppn"]').click();
    const [ppnDl] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#ppn-export-btn').click()
    ]);
    expect(ppnDl.suggestedFilename()).toMatch(/^spt_ppn_\d{4}-\d{2}\.csv$/);
    const ppnCsv = fs.readFileSync(await ppnDl.path(), 'utf8').trim().split('\n');
    expect(ppnCsv[0]).toBe('period,direction,tax_code,counterparty_npwp,faktur_number,base_dpp,ppn');
    expect(ppnCsv.length).toBeGreaterThan(1);
    expect(ppnCsv.some((l) => l.includes('input') && l.includes('1100000'))).toBe(true);

    // Bukti Potong export (Withholding tab).
    await page.locator('[data-tax-tab="withholding"]').click();
    const [whtDl] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#wht-export-btn').click()
    ]);
    expect(whtDl.suggestedFilename()).toMatch(/^bukti_potong_\d{4}-\d{2}\.csv$/);
    const whtCsv = fs.readFileSync(await whtDl.path(), 'utf8').trim().split('\n');
    expect(whtCsv[0]).toBe('period,direction,withholding_code,counterparty_npwp,bukti_potong_no,base_dpp,pph');
    expect(whtCsv.length).toBeGreaterThan(1);
    expect(whtCsv.some((l) => l.includes('withheld_by_us'))).toBe(true);
});
