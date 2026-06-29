// @ts-check
const { test, expect } = require('@playwright/test');

// End-to-end: an invoice where the CUSTOMER withholds PPh. On payment, the customer
// pays net and gives a bukti potong; the withheld PPh is a creditable prepayment.
// markInvoicePaid stamps the amount and INV-PAY reclasses it: Dr 1150 / Cr Cash. Net:
// Cash = net received, 1150 = creditable PPh, A/R = total (settled). Subtotal 10,000,000,
// customer PPh 23 2% = 200,000 (no PPN here, to isolate withholding).

test('an invoice with customer withholding posts creditable PPh to 1150 on payment', async ({ page }) => {
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
        const due = new Date(Date.now() + 14 * 86400000);
        const created = await ds.createInvoiceDraft(uid, {
            customer_name: 'QA WHT Customer', customer_email: 'qa@example.com',
            due_date: due, due_terms: 'due_in_14_days', payment_collection_method: 'manual_only',
            customer_withholding_rate: 2, customer_withholding_type: 'PPh 23', customer_withholding_code: 'PPH23',
            customer_npwp: '01.234.567.8-901.000',
            items: [{ description: 'Consulting', quantity: 1, unit_price: 10000000, amount: 10000000 }]
        });
        await ds.finalizeInvoice(uid, created.id, { markSent: false });
        await ds.markInvoicePaid(uid, created.id, {});
        const inv = await ds.getInvoice(uid, created.id);
        const js = await ds.listJournals(uid, { max: 25 });
        const j = js.find((x) => x.source && x.source.id === inv.linked_transaction_id) || null;
        return { payTxId: inv.linked_transaction_id, journal: j ? { lines: j.lines, is_balanced: j.is_balanced } : null };
    });

    expect(r.journal, 'payment posted a journal').not.toBeNull();
    const j = r.journal;
    const net = (code) => j.lines.filter((l) => l.account_code === code).reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
    expect(j.is_balanced).toBe(true);
    expect(net('1000')).toBe(9800000);    // Cash = net received (10M − 200k)
    expect(net('1150')).toBe(200000);     // creditable PPh withheld by customer
    expect(net('1100')).toBe(-10000000);  // A/R fully settled

    // Withholding tab shows the creditable PPh.
    await page.reload();
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });
    await page.locator('[data-tax-tab="withholding"]').click();
    await expect(page.locator('#kpi-wht-credit')).toHaveText(/Rp[1-9]/, { timeout: 20000 });
});
