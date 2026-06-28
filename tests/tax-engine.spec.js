const { test, expect } = require('@playwright/test');

// Pure-logic unit test for the tax engine (Indonesia Tax Center, Phase 1: PPN).
// Mirrors accounting-engine.spec.js: navigate to any served app page, import the
// ESM module in the browser, assert against its pure outputs. No Firestore, no
// auth — the engine has no I/O. See docs/INDONESIA_TAX_CENTER_ARCHITECTURE.md.

test('tax engine classifies PPN output/input gated by PKP status', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/tax-engine.js');
        const pkp = { pkp_status: 'pkp' };
        const nonPkp = { pkp_status: 'non_pkp' };
        const c = (collection, document, profile, mappings) => e.classifyTax({ collection, document, profile, mappings });
        return {
            // PKP sales invoice → output VAT on 2100, credit, 11% rounded.
            invoiceOut: c('invoices', { status: 'sent', amount: 10000000 }, pkp),
            // Draft invoice → no tax.
            invoiceDraft: c('invoices', { status: 'draft', amount: 10000000 }, pkp),
            // PKP purchase bill → input VAT on 1130, debit.
            billIn: c('bills', { amount: 5000000, vendor_name: 'AWS' }, pkp),
            // PKP cash expense → input VAT.
            expenseIn: c('transactions', { type: 'expense', amount: 1000000 }, pkp),
            // PKP income → output VAT.
            incomeOut: c('transactions', { type: 'income', amount: 2000000 }, pkp),
            // Non-PKP charges no VAT anywhere.
            nonPkpInvoice: c('invoices', { status: 'sent', amount: 10000000 }, nonPkp),
            // Missing profile defaults to Non-PKP (never invents output VAT).
            noProfileInvoice: c('invoices', { status: 'sent', amount: 10000000 }),
            // Settlement leg (linked) → no double VAT.
            billPayLeg: c('transactions', { type: 'expense', amount: 5000000, linked_bill_id: 'b1' }, pkp),
            // Transfer → neutral.
            transfer: c('transactions', { type: 'transfer', amount: 1000000 }, pkp),
            // Rounding: 11% of 12345 = 1357.95 → 1358.
            rounding: e.roundTax((12345 * 11) / 100, 'PPN_OUT_11'),
            rate: e.rateFor('PPN_OUT_11')
        };
    });

    // PKP sales invoice: one output line, 11% of 10,000,000 = 1,100,000, credit to 2100.
    expect(r.invoiceOut.skipped).toBe(false);
    expect(r.invoiceOut.tax_lines.length).toBe(1);
    expect(r.invoiceOut.tax_lines[0].tax_code).toBe('PPN_OUT_11');
    expect(r.invoiceOut.tax_lines[0].direction).toBe('output');
    expect(r.invoiceOut.tax_lines[0].gl_account_code).toBe('2100');
    expect(r.invoiceOut.tax_lines[0].debit_or_credit).toBe('credit');
    expect(r.invoiceOut.tax_lines[0].tax_amount).toBe(1100000);
    expect(r.invoiceOut.tax_lines[0].taxable_base).toBe(10000000);

    // Draft invoice and settlement/transfer legs bear no tax.
    for (const key of ['invoiceDraft', 'billPayLeg', 'transfer']) {
        expect(r[key].skipped, `${key} must skip`).toBe(true);
        expect(r[key].tax_lines.length, `${key} has no lines`).toBe(0);
    }

    // PKP purchase → input VAT to 1130 (debit).
    expect(r.billIn.tax_lines[0].tax_code).toBe('PPN_IN_11');
    expect(r.billIn.tax_lines[0].gl_account_code).toBe('1130');
    expect(r.billIn.tax_lines[0].debit_or_credit).toBe('debit');
    expect(r.billIn.tax_lines[0].tax_amount).toBe(550000);
    expect(r.expenseIn.tax_lines[0].direction).toBe('input');
    expect(r.incomeOut.tax_lines[0].direction).toBe('output');

    // Non-PKP / missing profile → never any VAT.
    expect(r.nonPkpInvoice.tax_lines.length).toBe(0);
    expect(r.noProfileInvoice.tax_lines.length).toBe(0);

    // Rounding + rate table.
    expect(r.rounding).toBe(1358);
    expect(r.rate).toBe(11);
});
