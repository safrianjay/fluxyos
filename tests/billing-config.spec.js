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

test('billing config exposes enforced trial limits', async ({ page }) => {
    await page.goto('/pricing');
    const result = await page.evaluate(async () => {
        const billing = await import('/assets/js/billing-config.js');
        return billing.PLAN_LIMITS.trial;
    });

    expect(result).toMatchObject({
        tier: 'trial',
        seat_limit: 1,
        storage_limit_bytes: 5 * 1024 * 1024,
        storage_limit_gb: null,
        ai_chat_limit: 3,
        ai_chat_scope: 'trial'
    });
});

test('voucher math is integer-exact and taxes the discounted subtotal', async ({ page }) => {
    await page.goto('/pricing');
    const result = await page.evaluate(async () => {
        const billing = await import('/assets/js/billing-config.js');
        const cases = [
            ['growth', 'monthly', 20],
            ['core', 'annually', 13],
            ['enterprise', 'monthly', 100],
            ['growth', 'annually', 1]
        ].map(([plan, frequency, percent]) => {
            const calc = billing.calculateBilling(plan, frequency, { discount_value: percent });
            return [plan, frequency, percent, calc.subtotalAmount, calc.voucherDiscountAmount, calc.estimatedTaxAmount, calc.totalAmount];
        });
        const noVoucher = billing.calculateBilling('growth', 'monthly');
        const integerExact = cases.every(row => row.slice(3).every(Number.isInteger));
        return { cases, integerExact, noVoucherDiscount: noVoucher.voucherDiscountAmount, noVoucherTotal: noVoucher.totalAmount };
    });

    // discount = subtotal * percent / 100; tax = 11% of (subtotal - discount);
    // total = subtotal - discount + tax. All exact integers (subtotals are
    // multiples of 10,000) — the same math firestore.rules re-enforces.
    expect(result.cases).toEqual([
        ['growth', 'monthly', 20, 8500000, 1700000, 748000, 7548000],
        ['core', 'annually', 13, 33480000, 4352400, 3204036, 32331636],
        ['enterprise', 'monthly', 100, 18000000, 18000000, 0, 0],
        ['growth', 'annually', 1, 81480000, 814800, 8873172, 89538372]
    ]);
    expect(result.integerExact).toBe(true);
    // No-voucher path stays byte-identical to the pre-voucher behavior.
    expect(result.noVoucherDiscount).toBe(0);
    expect(result.noVoucherTotal).toBe(9435000);
});
