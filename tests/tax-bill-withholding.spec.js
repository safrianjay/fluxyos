// @ts-check
const { test, expect } = require('@playwright/test');

// End-to-end: a PKP service bill with BOTH PPN (input) and PPh 23 withholding. The
// amount is the total (PPN-inclusive). The engine extracts PPN to 1130 and withholds
// PPh on the base to 2110, reducing A/P to the net paid to the vendor. Real Firestore
// + deployed rules. base 10,000,000 / PPN 1,100,000 / PPh23 2% = 200,000.

test('a PKP bill with PPN + PPh 23 posts input VAT (1130) and withholding (2110)', async ({ page }) => {
    await page.goto('/tax-center.html');
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        await ds.saveTaxProfile(uid, { pkp_status: 'pkp', default_ppn_rate: 11 });
        const ref = await ds.addBill(uid, {
            amount: 11100000, vendor_name: 'QA Service Vendor', category: 'Infrastructure',
            type: 'expense', status: 'Completed', icon: '💸',
            tax_rate_percent: 11, withholding_rate: 2, withholding_type: 'PPh 23', withholding_code: 'PPH23',
            bukti_potong_no: '001/PPH23/2026'
        });
        const js = await ds.listJournals(uid, { max: 25 });
        const j = js.find((x) => x.source && x.source.id === ref.id) || null;
        return { journal: j ? { lines: j.lines, is_balanced: j.is_balanced, total_debit: j.total_debit, total_credit: j.total_credit } : null };
    });

    expect(r.journal, 'bill posted a journal').not.toBeNull();
    const j = r.journal;
    const net = (code) => j.lines.filter((l) => l.account_code === code).reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
    expect(j.is_balanced).toBe(true);
    expect(j.total_debit).toBe(j.total_credit);
    expect(net('6300')).toBe(10000000);   // Expense = base
    expect(net('1130')).toBe(1100000);    // input PPN
    expect(net('2110')).toBe(-200000);    // PPh Payable (credit) = 2% of base
    expect(net('2000')).toBe(-10900000);  // A/P (credit) = total − PPh = net to vendor

    // Withholding tab reflects the ledger: PPh Payable outstanding is positive, and the
    // bukti potong shows in the list.
    await page.reload();
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });
    await page.locator('[data-tax-tab="withholding"]').click();
    await expect(page.locator('#kpi-wht-payable')).toHaveText(/Rp[1-9]/, { timeout: 20000 });
    await expect(page.locator('#wht-summary-body')).toContainText('001/PPH23/2026', { timeout: 20000 });
});
