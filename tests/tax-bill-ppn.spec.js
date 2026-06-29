// @ts-check
const { test, expect } = require('@playwright/test');

// End-to-end: a PKP bill with a tax rate posts input PPN. The entered amount is the
// total (tax-inclusive); BILL-ACCRUE books Dr Expense / Cr A/P for the total, and the
// tax engine extracts the PPN into 1130 (Dr 1130 / Cr Expense for the PPN). Net:
// Expense = base, 1130 = PPN, A/P = total. Real Firestore + deployed rules.

test('a PKP bill with a tax rate posts input PPN (extracted to 1130)', async ({ page }) => {
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
            amount: 11100000, vendor_name: 'QA Vendor PPN', category: 'Infrastructure',
            type: 'expense', status: 'Completed', icon: '💸', tax_rate_percent: 11
        });
        const js = await ds.listJournals(uid, { max: 25 });
        const j = js.find((x) => x.source && x.source.id === ref.id) || null;
        return { journal: j ? { lines: j.lines, is_balanced: j.is_balanced, total_debit: j.total_debit, total_credit: j.total_credit } : null };
    });

    expect(r.journal, 'bill posted a journal').not.toBeNull();
    const j = r.journal;
    const sum = (code, side) => j.lines.filter((l) => l.account_code === code).reduce((s, l) => s + (Number(l[side]) || 0), 0);
    expect(j.is_balanced).toBe(true);
    expect(j.total_debit).toBe(j.total_credit);
    expect(sum('1130', 'debit')).toBe(1100000);                          // input PPN extracted
    expect(sum('6300', 'debit') - sum('6300', 'credit')).toBe(10000000); // Expense = base
    expect(sum('2000', 'credit')).toBe(11100000);                        // A/P = total owed
});
