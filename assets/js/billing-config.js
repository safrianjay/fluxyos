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

export function calculateBilling(planId, billingFrequency) {
    const normalizedPlanId = normalizePlanId(planId);
    const normalizedBillingFrequency = normalizeBillingFrequency(billingFrequency);
    const plan = BILLING_PLANS[normalizedPlanId];
    const monthlyDisplayAmount = normalizedBillingFrequency === 'annually'
        ? plan.annualMonthlyEquivalent
        : plan.monthly;
    const subtotalAmount = normalizedBillingFrequency === 'annually'
        ? plan.annualMonthlyEquivalent * 12
        : plan.monthly;
    const estimatedTaxAmount = Math.round(subtotalAmount * TAX_RATE);

    return {
        plan,
        planId: normalizedPlanId,
        billingFrequency: normalizedBillingFrequency,
        monthlyDisplayAmount,
        subtotalAmount,
        estimatedTaxAmount,
        totalAmount: subtotalAmount + estimatedTaxAmount
    };
}

export function formatIDR(value) {
    return `Rp ${Math.round(Math.abs(Number(value) || 0)).toLocaleString('id-ID')}`;
}
