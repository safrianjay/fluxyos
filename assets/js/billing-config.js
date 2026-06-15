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

// Single source of truth for plan pricing. Self-serve plans carry `monthly` +
// `annualMonthlyEquivalent` (raw integer Rupiah; annual subtotal is the
// equivalent × 12). Enterprise AI is sales-led: it has NO public/self-serve
// amount (`salesLed: true`), only a `startingFrom` display anchor and a
// Contact Sales flow — never a checkout. firestore.rules `isValidBillingAmounts`
// mirrors the self-serve amounts below and must change in lockstep.
export const BILLING_PLANS = {
    starter: {
        id: 'starter',
        name: 'Starter',
        monthly: 1290000,
        annualMonthlyEquivalent: 990000,
        description: 'For founders, freelancers, and small teams running finance in one place.',
        benefits: [
            'Transactions, Bills & Budgeting',
            'Basic Reporting',
            '1 user',
            'Limited AI usage',
            'Limited document processing'
        ]
    },
    core: {
        id: 'core',
        name: 'Core Ops',
        monthly: 3490000,
        annualMonthlyEquivalent: 2790000,
        description: 'For growing operational teams with dedicated finance and admin.',
        benefits: [
            'Everything in Starter',
            'Multi-user with approval workflow',
            'Advanced reports',
            'Higher AI usage limits',
            'Higher document processing limits'
        ]
    },
    growth: {
        id: 'growth',
        name: 'Growth Engine',
        monthly: 6990000,
        annualMonthlyEquivalent: 5590000,
        description: 'For scaling companies that need forecasting and AI financial analysis.',
        benefits: [
            'Everything in Core Ops',
            'AI Finance Analyst & forecasting',
            'Department budgeting & advanced insights',
            'API access',
            'Gateway integrations'
        ]
    },
    enterprise: {
        id: 'enterprise',
        name: 'Enterprise AI',
        salesLed: true,
        startingFrom: 15000000,
        description: 'Unlimited AI and processing with SSO, dedicated support, and custom limits.',
        benefits: [
            'Unlimited AI usage & processing',
            'SSO & WhatsApp AI Assistant',
            'Dedicated onboarding & priority support',
            'Custom integrations & limits'
        ]
    }
};

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

// Plan seat / storage / AI / document limits surfaced on the Billing & plan
// settings page and reused by client/API guards. `storage_limit_bytes` is the
// canonical storage quota; `storage_limit_gb` remains for GB-oriented
// display/tests. `ai_chat_limit` / `doc_processing_limit` are per-month quotas
// for self-serve plans (scope `'plan'`, reset monthly) — `null` means unlimited.
// The trial keeps its lifetime AI cap of 3 (scope `'trial'`). These numbers are
// tunable business constants; the firestore.rules per-plan limit map mirrors
// `ai_chat_limit` / `doc_processing_limit` and must change in lockstep.
export const PLAN_LIMITS = {
    trial:      { tier: 'trial',      seat_limit: 1,  storage_limit_bytes: 5 * MB,  storage_limit_gb: null, ai_chat_limit: 3,   ai_chat_scope: 'trial', doc_processing_limit: null },
    starter:    { tier: 'starter',    seat_limit: 1,  storage_limit_bytes: 2 * GB,  storage_limit_gb: 2,    ai_chat_limit: 25,  ai_chat_scope: 'plan',  doc_processing_limit: 25 },
    basic:      { tier: 'basic',      seat_limit: 5,  storage_limit_bytes: 5 * GB,  storage_limit_gb: 5,    ai_chat_limit: 150, ai_chat_scope: 'plan',  doc_processing_limit: 150 },
    core:       { tier: 'basic',      seat_limit: 5,  storage_limit_bytes: 5 * GB,  storage_limit_gb: 5,    ai_chat_limit: 150, ai_chat_scope: 'plan',  doc_processing_limit: 150 },
    growth:     { tier: 'growth',     seat_limit: 10, storage_limit_bytes: 10 * GB, storage_limit_gb: 10,   ai_chat_limit: 750, ai_chat_scope: 'plan',  doc_processing_limit: 750 },
    enterprise: { tier: 'enterprise', seat_limit: 50, storage_limit_bytes: 50 * GB, storage_limit_gb: 50,   ai_chat_limit: null, ai_chat_scope: 'plan',  doc_processing_limit: null, storage_note: 'Unlimited storage available on custom agreement.' }
};

// Display name fallbacks for plan ids that are not in BILLING_PLANS (e.g. trial).
export const PLAN_DISPLAY_NAMES = {
    trial: 'Trial',
    starter: 'Starter',
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

// Sales-led plans (Enterprise AI) have no self-serve price, so there is nothing
// to compute — callers must treat a `salesLed` result as "Contact Sales" and
// never build a checkout/payment request from it.
export function isSalesLedPlan(planId) {
    return BILLING_PLANS[planId]?.salesLed === true;
}

export function calculateBilling(planId, billingFrequency, voucher = null) {
    const normalizedPlanId = normalizePlanId(planId);
    const normalizedBillingFrequency = normalizeBillingFrequency(billingFrequency);
    const plan = BILLING_PLANS[normalizedPlanId];
    if (plan.salesLed || typeof plan.monthly !== 'number') {
        return {
            plan,
            planId: normalizedPlanId,
            billingFrequency: normalizedBillingFrequency,
            salesLed: true,
            monthlyDisplayAmount: null,
            subtotalAmount: null,
            voucherDiscountAmount: 0,
            estimatedTaxAmount: null,
            totalAmount: null
        };
    }
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
