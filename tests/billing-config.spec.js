const { test, expect } = require('@playwright/test');

test('billing config calculates every self-serve package and safe query fallback', async ({ page }) => {
    await page.goto('/pricing');
    const result = await page.evaluate(async () => {
        const billing = await import('/assets/js/billing-config.js');
        const cases = [
            ['starter', 'monthly'],
            ['starter', 'annually'],
            ['core', 'monthly'],
            ['core', 'annually'],
            ['growth', 'monthly'],
            ['growth', 'annually']
        ].map(([plan, frequency]) => billing.calculateBilling(plan, frequency));
        return {
            cases,
            enterprise: billing.calculateBilling('enterprise', 'monthly'),
            enterpriseIsSalesLed: billing.isSalesLedPlan('enterprise'),
            fallback: billing.getCheckoutSelection('?plan=invalid&billing=weekly')
        };
    });

    expect(result.cases.map(row => [row.planId, row.billingFrequency, row.subtotalAmount, row.estimatedTaxAmount, row.totalAmount])).toEqual([
        ['starter', 'monthly', 1290000, 141900, 1431900],
        ['starter', 'annually', 11880000, 1306800, 13186800],
        ['core', 'monthly', 3490000, 383900, 3873900],
        ['core', 'annually', 33480000, 3682800, 37162800],
        ['growth', 'monthly', 6990000, 768900, 7758900],
        ['growth', 'annually', 67080000, 7378800, 74458800]
    ]);
    // Enterprise AI is sales-led: no self-serve amount, never a checkout total.
    expect(result.enterpriseIsSalesLed).toBe(true);
    expect(result.enterprise.salesLed).toBe(true);
    expect(result.enterprise.subtotalAmount).toBeNull();
    expect(result.enterprise.totalAmount).toBeNull();
    expect(result.fallback).toEqual({ planId: 'growth', billingFrequency: 'annually' });
});

test('billing config exposes enforced trial and per-plan limits', async ({ page }) => {
    await page.goto('/pricing');
    const result = await page.evaluate(async () => {
        const billing = await import('/assets/js/billing-config.js');
        return {
            trial: billing.PLAN_LIMITS.trial,
            starter: billing.PLAN_LIMITS.starter,
            core: billing.PLAN_LIMITS.core,
            growth: billing.PLAN_LIMITS.growth,
            enterprise: billing.PLAN_LIMITS.enterprise
        };
    });

    expect(result.trial).toMatchObject({
        tier: 'trial', seat_limit: 1, storage_limit_bytes: 5 * 1024 * 1024,
        storage_limit_gb: null, ai_chat_limit: 3, ai_chat_scope: 'trial', doc_processing_limit: null
    });
    expect(result.starter).toMatchObject({ seat_limit: 1, ai_chat_limit: 25, ai_chat_scope: 'plan', doc_processing_limit: 25 });
    expect(result.core).toMatchObject({ seat_limit: 5, ai_chat_limit: 150, doc_processing_limit: 150 });
    expect(result.growth).toMatchObject({ seat_limit: 10, ai_chat_limit: 750, doc_processing_limit: 750 });
    // Enterprise = unlimited (null) AI + document processing.
    expect(result.enterprise).toMatchObject({ seat_limit: 50, ai_chat_limit: null, doc_processing_limit: null });
});

test('voucher math is integer-exact and taxes the discounted subtotal', async ({ page }) => {
    await page.goto('/pricing');
    const result = await page.evaluate(async () => {
        const billing = await import('/assets/js/billing-config.js');
        const cases = [
            ['growth', 'monthly', 20],
            ['core', 'annually', 13],
            ['starter', 'monthly', 100],
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
        ['growth', 'monthly', 20, 6990000, 1398000, 615120, 6207120],
        ['core', 'annually', 13, 33480000, 4352400, 3204036, 32331636],
        ['starter', 'monthly', 100, 1290000, 1290000, 0, 0],
        ['growth', 'annually', 1, 67080000, 670800, 7305012, 73714212]
    ]);
    expect(result.integerExact).toBe(true);
    // No-voucher path stays byte-identical to the pre-voucher behavior.
    expect(result.noVoucherDiscount).toBe(0);
    expect(result.noVoucherTotal).toBe(7758900);
});
