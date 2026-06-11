export const TAX_RATE = 0.11;
export const DEFAULT_PLAN_ID = 'growth';
export const DEFAULT_BILLING_FREQUENCY = 'annually';

export const BILLING_FREQUENCIES = ['monthly', 'annually'];
export const PAYMENT_METHODS = ['qris', 'va', 'card', 'invoice'];

// Static manual-QRIS merchant details. The merchant QR is shared (one merchant),
// so these are display constants rendered directly — never persisted per user and
// never sensitive credentials. Source of truth for the number is the attached QR.
export const QRIS_PAYMENT_INFO = {
    imagePath: 'assets/images/qris-tanda360.png',
    merchantName: 'Tanda360Plus-Digital',
    recipientName: 'Safrian Jayadi',
    bankName: 'OCBC Nisp',
    referenceNumber: '6938-1098-7877',
    currency: 'IDR'
};

export const BILLING_PLANS = {
    core: {
        id: 'core',
        name: 'Core Ops',
        monthly: 3500000,
        annualMonthlyEquivalent: 2790000,
        description: 'For scaling businesses needing a unified source of truth.',
        benefits: [
            'Global Ledger with automated reconciliation',
            'Up to 3 marketplaces active sync',
            'Standard Bank API integrations',
            'Basic reports and financial visibility'
        ]
    },
    growth: {
        id: 'growth',
        name: 'Growth Engine',
        monthly: 8500000,
        annualMonthlyEquivalent: 6790000,
        description: 'Complete financial control and high-velocity gateway sync for growing businesses.',
        benefits: [
            'Everything in Core Ops',
            'Payment Gateways up to 150 transactions/sec',
            'Active Spending Control rules',
            'Multi-entity support up to 5 entities'
        ]
    },
    enterprise: {
        id: 'enterprise',
        name: 'Enterprise AI',
        monthly: 18000000,
        annualMonthlyEquivalent: 14390000,
        description: 'Advanced AI forecasting and unlimited infrastructure limits.',
        benefits: [
            'Everything in Growth Engine',
            'Financial Projections via AI Modeling',
            'Unlimited entities and API connections',
            'Dedicated Technical Success Manager'
        ]
    }
};

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

// Plan seat / storage / AI limits surfaced on the Billing & plan settings page
// and reused by client/API guards. `storage_limit_bytes` is the canonical quota
// value; `storage_limit_gb` remains for existing GB-oriented display/tests.
export const PLAN_LIMITS = {
    trial:      { tier: 'trial',      seat_limit: 1,  storage_limit_bytes: 5 * MB,  storage_limit_gb: null, ai_chat_limit: 3, ai_chat_scope: 'trial' },
    basic:      { tier: 'basic',      seat_limit: 5,  storage_limit_bytes: 5 * GB,  storage_limit_gb: 5, ai_chat_limit: null, ai_chat_scope: 'plan' },
    core:       { tier: 'basic',      seat_limit: 5,  storage_limit_bytes: 5 * GB,  storage_limit_gb: 5, ai_chat_limit: null, ai_chat_scope: 'plan' },
    growth:     { tier: 'growth',     seat_limit: 10, storage_limit_bytes: 10 * GB, storage_limit_gb: 10, ai_chat_limit: null, ai_chat_scope: 'plan' },
    enterprise: { tier: 'enterprise', seat_limit: 50, storage_limit_bytes: 50 * GB, storage_limit_gb: 50, ai_chat_limit: null, ai_chat_scope: 'plan', storage_note: 'Unlimited storage available on custom agreement.' }
};

// Display name fallbacks for plan ids that are not in BILLING_PLANS (e.g. trial).
export const PLAN_DISPLAY_NAMES = {
    trial: 'Trial',
    basic: 'Basic',
    core: 'Core Ops',
    growth: 'Growth Engine',
    enterprise: 'Enterprise AI'
};

export function getPlanLimits(planId) {
    return PLAN_LIMITS[planId] || null;
}

// Map an arbitrary settings plan id to a real, purchasable checkout plan id.
// The Billing & plan page lets users pick basic/growth/enterprise; the live
// checkout (`/checkout`) speaks core/growth/enterprise, so `basic → core`.
export function resolveCheckoutPlanId(planId) {
    if (planId === 'basic') return 'core';
    return normalizePlanId(planId);
}

export function normalizePlanId(value) {
    return Object.prototype.hasOwnProperty.call(BILLING_PLANS, value)
        ? value
        : DEFAULT_PLAN_ID;
}

export function normalizeBillingFrequency(value) {
    return BILLING_FREQUENCIES.includes(value)
        ? value
        : DEFAULT_BILLING_FREQUENCY;
}

export function normalizePaymentMethod(value) {
    return PAYMENT_METHODS.includes(value) ? value : null;
}

export function getCheckoutSelection(search = '') {
    const params = new URLSearchParams(search);
    return {
        planId: normalizePlanId(params.get('plan')),
        billingFrequency: normalizeBillingFrequency(params.get('billing'))
    };
}

// Voucher percentage discount on the plan subtotal. All plan subtotals are
// multiples of 10.000, so subtotal/100*percent is an exact integer — the same
// integer math firestore.rules re-runs (`subtotal * percent / 100`), so client
// and rules never disagree by a rounding step.
export function calculateVoucherDiscountAmount(subtotalAmount, percent) {
    const normalizedPercent = Number.isInteger(percent) && percent >= 1 && percent <= 100 ? percent : 0;
    return (subtotalAmount / 100) * normalizedPercent;
}

export function calculateBilling(planId, billingFrequency, voucher = null) {
    const normalizedPlanId = normalizePlanId(planId);
    const normalizedBillingFrequency = normalizeBillingFrequency(billingFrequency);
    const plan = BILLING_PLANS[normalizedPlanId];
    const monthlyDisplayAmount = normalizedBillingFrequency === 'annually'
        ? plan.annualMonthlyEquivalent
        : plan.monthly;
    const subtotalAmount = normalizedBillingFrequency === 'annually'
        ? plan.annualMonthlyEquivalent * 12
        : plan.monthly;
    const voucherDiscountAmount = voucher
        ? calculateVoucherDiscountAmount(subtotalAmount, voucher.discount_value)
        : 0;
    // PPN applies to the discounted subtotal. (subtotal - discount) is always a
    // multiple of 100, so the 11% is exact — identical to the rules check.
    const estimatedTaxAmount = ((subtotalAmount - voucherDiscountAmount) / 100) * 11;

    return {
        plan,
        planId: normalizedPlanId,
        billingFrequency: normalizedBillingFrequency,
        monthlyDisplayAmount,
        subtotalAmount,
        voucherDiscountAmount,
        estimatedTaxAmount,
        totalAmount: subtotalAmount - voucherDiscountAmount + estimatedTaxAmount
    };
}

export function formatIDR(value) {
    return `Rp${Math.round(Math.abs(Number(value) || 0)).toLocaleString('id-ID')}`;
}
