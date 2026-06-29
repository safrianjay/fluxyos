// @ts-check
const { test, expect } = require('@playwright/test');

// End-to-end: a PKP invoice with a tax rate posts PPN correctly on finalize. INV-ISSUE
// books A/R for the total; the tax engine reclasses the PPN out of Revenue into 2100
// PPN Keluaran (Dr Revenue / Cr 2100 for the tax). Net: A/R = total, Revenue =
// subtotal, 2100 = tax. Runs as the QA account against real Firestore + deployed rules.

test('a PKP invoice with a tax rate posts PPN (revenue split out to 2100)', async ({ page }) => {
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
            customer_name: 'QA PPN Customer', customer_email: 'qa@example.com',
            due_date: due, due_terms: 'due_in_14_days', tax_rate_percent: 11,
            payment_collection_method: 'manual_only',
            items: [{ description: 'Service', quantity: 1, unit_price: 10000000, amount: 10000000 }]
        });
        await ds.finalizeInvoice(uid, created.id, { markSent: false });
        const inv = await ds.getInvoice(uid, created.id);
        const j = inv.journal_ref ? await ds.getJournalById(uid, inv.journal_ref) : null;
        return {
            subtotal: inv.subtotal_amount, tax: inv.tax_amount, total: inv.total_amount,
            acctStatus: inv.accounting_status,
            journal: j ? { lines: j.lines, is_balanced: j.is_balanced, total_debit: j.total_debit, total_credit: j.total_credit } : null
        };
    });

    expect(r.subtotal).toBe(10000000);
    expect(r.tax).toBe(1100000);
    expect(r.total).toBe(11100000);
    expect(r.acctStatus).toBe('posted');
    expect(r.journal, 'invoice posted a journal').not.toBeNull();
    const j = r.journal;
    const sum = (code, side) => j.lines.filter((l) => l.account_code === code).reduce((s, l) => s + (Number(l[side]) || 0), 0);
    expect(j.is_balanced).toBe(true);
    expect(j.total_debit).toBe(j.total_credit);
    expect(sum('1100', 'debit')).toBe(11100000);                          // A/R = total
    expect(sum('4000', 'credit') - sum('4000', 'debit')).toBe(10000000);  // Revenue = subtotal
    expect(sum('2100', 'credit')).toBe(1100000);                          // PPN Keluaran = tax
});
