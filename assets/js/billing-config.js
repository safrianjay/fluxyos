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

// Plan identity and copy. AMOUNTS live in PLAN_PRICES above, keyed by billing
// currency — a plan has no single price. Enterprise AI is sales-led: it has NO
// public/self-serve amount (`salesLed: true`), only a `startingFrom` display
// anchor and a Contact Sales flow — never a checkout.

// ---- Price book -------------------------------------------------------------
//
// FluxyOS bills in the customer's own currency. Prices are PINNED per currency,
// never converted at runtime: a price that moves with the daily FX fix is not a
// price, and it cannot be put on an invoice or a bank-transfer instruction.
//
// Amounts are integer MINOR units — IDR minorPerUnit 1 (rupiah ARE minor units),
// PHP 100 (centavos). The PHP ladder was pinned near parity with the IDR list at
// 286.39 IDR/PHP (2026-08-21) and rounded to local price points.
//
// firestore.rules billingSubtotal() mirrors the ANNUAL and MONTHLY subtotals
// derived from this table and must change in lockstep. tests/billing-price-book
// .check.js fails the build when they drift.
export const BILLING_CURRENCIES = ['IDR', 'PHP'];

export const PLAN_PRICES = {
    IDR: {
        starter: { monthly: 1290000, annualMonthlyEquivalent: 990000 },
        core:    { monthly: 3490000, annualMonthlyEquivalent: 2790000 },
        growth:  { monthly: 6990000, annualMonthlyEquivalent: 5590000 },
        enterprise: { startingFrom: 15000000 }
    },
    PHP: {
        starter: { monthly: 449000,  annualMonthlyEquivalent: 349000 },
        core:    { monthly: 1219000, annualMonthlyEquivalent: 979000 },
        growth:  { monthly: 2449000, annualMonthlyEquivalent: 1959000 },
        enterprise: { startingFrom: 5200000 }
    }
};

// Sales tax on FluxyOS's OWN subscription, by billing currency. This is not the
// customer's ledger tax — it is what FluxyOS charges for the subscription.
// Indonesia: PPN 11%. Philippines: 12% VAT on digital services (RA 11967).
export const BILLING_TAX = {
    IDR: { rate: 11, label: 'PPN' },
    PHP: { rate: 12, label: 'VAT' }
};

// How a customer in each billing currency actually pays. QRIS is an Indonesian
// rail — a Philippine customer cannot scan it — so the method list is per
// currency, not global.
export const PAYMENT_INSTRUCTIONS = {
    IDR: { method: 'qris', methods: ['qris', 'va', 'card', 'invoice'] },
    PHP: {
        method: 'bank_transfer',
        methods: ['bank_transfer', 'invoice'],
        // TODO before PH launch — until bankName and accountNumber are filled,
        // checkout renders a "contact us to complete payment" state instead of
        // transfer instructions. See isPaymentInstructionReady().
        bankName: '',
        accountName: '',
        accountNumber: '',
        swift: '',
        note: 'Transfer the total above and email the receipt to hello@fluxyos.com.'
    }
};

export function isPaymentInstructionReady(currency) {
    const info = PAYMENT_INSTRUCTIONS[normalizeBillingCurrency(currency)];
    if (!info) return false;
    if (info.method === 'qris') return true;
    return !!(info.bankName && info.accountNumber);
}

export function normalizeBillingCurrency(value) {
    const c = String(value || '').toUpperCase();
    return BILLING_CURRENCIES.includes(c) ? c : 'IDR';
}

// The currency FluxyOS bills this workspace in, from the business country set at
// onboarding. Markets without a pinned price book bill in IDR until one exists —
// never a live conversion.
export function billingCurrency() {
    const country = (window.FluxyWorkspace && window.FluxyWorkspace.country) || null;
    return normalizeBillingCurrency({ ID: 'IDR', PH: 'PHP' }[country || 'ID']);
}

export function planPrice(planId, currency) {
    const book = PLAN_PRICES[normalizeBillingCurrency(currency)] || PLAN_PRICES.IDR;
    return book[normalizePlanId(planId)] || {};
}

export function billingTaxFor(currency) {
    return BILLING_TAX[normalizeBillingCurrency(currency)] || BILLING_TAX.IDR;
}

export const BILLING_PLANS = {
    starter: {
        id: 'starter',
        name: 'Starter',
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
// The trial keeps its lifetime AI cap of 1 (scope `'trial'`). `ai_chat_limit` is
// the SHARED Fluxy AI quota (AI chat + Overview AI Finance Summary) and resets
// each billing period. These numbers are tunable business constants; the
// firestore.rules per-plan limit map and `PLAN_AI_PERIOD_LIMITS` in
// netlify/functions/api.js mirror `ai_chat_limit` and must change in lockstep.
export const PLAN_LIMITS = {
    trial:      { tier: 'trial',      seat_limit: 1,  storage_limit_bytes: 5 * MB,  storage_limit_gb: null, ai_chat_limit: 1,   ai_chat_scope: 'trial', doc_processing_limit: null },
    starter:    { tier: 'starter',    seat_limit: 1,  storage_limit_bytes: 2 * GB,  storage_limit_gb: 2,    ai_chat_limit: 10,  ai_chat_scope: 'plan',  doc_processing_limit: 25 },
    basic:      { tier: 'basic',      seat_limit: 5,  storage_limit_bytes: 5 * GB,  storage_limit_gb: 5,    ai_chat_limit: 30,  ai_chat_scope: 'plan',  doc_processing_limit: 150 },
    core:       { tier: 'basic',      seat_limit: 5,  storage_limit_bytes: 5 * GB,  storage_limit_gb: 5,    ai_chat_limit: 30,  ai_chat_scope: 'plan',  doc_processing_limit: 150 },
    growth:     { tier: 'growth',     seat_limit: 10, storage_limit_bytes: 10 * GB, storage_limit_gb: 10,   ai_chat_limit: 100, ai_chat_scope: 'plan',  doc_processing_limit: 750 },
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

/**
 * Is FluxyOS's Indonesian PPN chargeable on this subscription?
 *
 * PPN is Indonesian VAT on an Indonesian seller's invoice. Indonesian VAT rules
 * treat exported digital services differently from domestic ones, so it is not
 * automatically charged to a customer outside Indonesia — a business decision the
 * seller makes, not a display preference. Keyed on the workspace's business
 * country; absent country = Indonesia, so no existing customer changes.
 *
 * NOTE: this changes what is CHARGED, not just what is shown.
 */
export function isPpnChargeable() {
    // Retained name for callers that only ask "is there a tax row?". Every
    // supported billing currency now carries one — Indonesia PPN 11%,
    // Philippines VAT 12% — so this is true wherever we have a price book.
    return billingTaxFor(billingCurrency()).rate > 0;
}

export function calculateBilling(planId, billingFrequency, voucher = null, currency = null) {
    const normalizedPlanId = normalizePlanId(planId);
    const normalizedBillingFrequency = normalizeBillingFrequency(billingFrequency);
    const ccy = normalizeBillingCurrency(currency || billingCurrency());
    const plan = BILLING_PLANS[normalizedPlanId];
    const price = planPrice(normalizedPlanId, ccy);
    if (plan.salesLed || typeof price.monthly !== 'number') {
        return {
            plan,
            planId: normalizedPlanId,
            billingFrequency: normalizedBillingFrequency,
            currency: ccy,
            salesLed: true,
            startingFrom: price.startingFrom ?? null,
            monthlyDisplayAmount: null,
            subtotalAmount: null,
            voucherDiscountAmount: 0,
            taxLabel: billingTaxFor(ccy).label,
            estimatedTaxAmount: null,
            totalAmount: null
        };
    }
    const monthlyDisplayAmount = normalizedBillingFrequency === 'annually'
        ? price.annualMonthlyEquivalent
        : price.monthly;
    const subtotalAmount = normalizedBillingFrequency === 'annually'
        ? price.annualMonthlyEquivalent * 12
        : price.monthly;
    const voucherDiscountAmount = voucher
        ? calculateVoucherDiscountAmount(subtotalAmount, voucher.discount_value)
        : 0;
    // Tax applies to the discounted subtotal. Every price in the book is a
    // multiple of 1000 minor units and discounts are integer percents, so this
    // integer math is exact — identical to the rules check, in both currencies.
    const tax = billingTaxFor(ccy);
    const estimatedTaxAmount = ((subtotalAmount - voucherDiscountAmount) / 100) * tax.rate;

    return {
        plan,
        planId: normalizedPlanId,
        billingFrequency: normalizedBillingFrequency,
        currency: ccy,
        monthlyDisplayAmount,
        subtotalAmount,
        voucherDiscountAmount,
        taxLabel: tax.label,
        taxRate: tax.rate,
        estimatedTaxAmount,
        totalAmount: subtotalAmount - voucherDiscountAmount + estimatedTaxAmount
    };
}

// Billing money, in the currency it was billed in. Minor units in, display out.
export function formatBilling(minor, currency) {
    const ccy = normalizeBillingCurrency(currency);
    return window.FluxyMoney.formatMoney(Math.round(Math.abs(Number(minor) || 0)), ccy);
}

// Legacy alias. Callers that never carried a currency get IDR, which is what
// they were already assuming — but new billing code must pass the currency.
export function formatIDR(value) {
    return formatBilling(value, 'IDR');
}
