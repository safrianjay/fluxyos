const { test, expect } = require('@playwright/test');

test('billing config calculates every package and safe query fallback', async ({ page }) => {
    await page.goto('/pricing');
    const result = await page.evaluate(async () => {
        const billing = await import('/assets/js/billing-config.js');
        const cases = [
            ['core', 'monthly'],
            ['core', 'annually'],
            ['growth', 'monthly'],
            ['growth', 'annually'],
            ['enterprise', 'monthly'],
            ['enterprise', 'annually']
        ].map(([plan, frequency]) => billing.calculateBilling(plan, frequency));
        return {
            cases,
            fallback: billing.getCheckoutSelection('?plan=invalid&billing=weekly')
        };
    });

    expect(result.cases.map(row => [row.planId, row.billingFrequency, row.subtotalAmount, row.estimatedTaxAmount, row.totalAmount])).toEqual([
        ['core', 'monthly', 3500000, 385000, 3885000],
        ['core', 'annually', 33480000, 3682800, 37162800],
        ['growth', 'monthly', 8500000, 935000, 9435000],
        ['growth', 'annually', 81480000, 8962800, 90442800],
        ['enterprise', 'monthly', 18000000, 1980000, 19980000],
        ['enterprise', 'annually', 172680000, 18994800, 191674800]
    ]);
    expect(result.fallback).toEqual({ planId: 'growth', billingFrequency: 'annually' });
});
