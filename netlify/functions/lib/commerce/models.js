// =============================================================================
// Commerce Integration Platform — canonical data models
//
// The Universal Commerce Transaction Model plus the normalized Order / Refund /
// Settlement shapes. Everything downstream of a connector's normalizer
// (storage, finance mapping, dashboard, AI) consumes ONLY these shapes —
// marketplace-specific fields never leave the connector layer.
//
// Conventions:
//   - Monetary fields are raw integer IDR (FluxyOS ledger convention). The
//     universal model keeps the spec's camelCase names (grossRevenue, …);
//     document metadata (platform, shop_id, created_at, …) is snake_case like
//     the rest of Firestore.
//   - validate*() returns { ok: true, value } with a cleaned copy, or
//     { ok: false, errors: [...] }. Never throws.
//
// See docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md §4.
// =============================================================================

const { PLATFORMS } = require('./constants');

const PLATFORM_IDS = Object.values(PLATFORMS);

// Universal Commerce Transaction Model — one doc per order-level financial
// event, platform-independent. Monetary fields: raw integer IDR.
const COMMERCE_TRANSACTION_MONEY_FIELDS = [
    'grossRevenue',
    'discount',
    'shippingIncome',
    'commissionFee',
    'platformFee',
    'paymentFee',
    'affiliateFee',
    'refundAmount',
    'tax',
    'netRevenue',
    'settlementAmount',
];

const COMMERCE_TRANSACTION_FIELDS = [
    // identity / linkage (snake_case metadata)
    'platform', 'shop_id', 'account_id', 'order_id', 'transaction_id',
    // money (camelCase per spec)
    ...COMMERCE_TRANSACTION_MONEY_FIELDS,
    'settlementDate',
    'currency',
    'status',
    // ledger linkage (written by finance mapping)
    'ledger_status', 'ledger_refs',
    'createdAt', 'updatedAt',
];

const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'completed', 'cancelled', 'refunded', 'unknown'];
const REFUND_STATUSES = ['requested', 'approved', 'rejected', 'completed', 'unknown'];
const SETTLEMENT_STATUSES = ['pending', 'paid', 'unknown'];

// Normalized order (commerce_orders). Items are EMBEDDED as an array — no
// separate commerce_order_items collection (Phase 0 deviation #5).
const COMMERCE_ORDER_FIELDS = [
    'platform', 'shop_id', 'account_id',
    'order_id', 'order_number', 'customer',
    'items', // [{ sku, name, quantity, unit_price, subtotal }]
    'subtotal', 'discount', 'voucher', 'shipping_fee', 'tax',
    'marketplace_fee', 'affiliate_fee', 'payment_fee', 'refund_amount',
    'gross_sales', 'net_sales',
    'currency', 'status',
    'order_created_at', 'order_updated_at',
    'created_at', 'updated_at',
];

const COMMERCE_REFUND_FIELDS = [
    'platform', 'shop_id', 'account_id',
    'refund_id', 'order_id', 'amount', 'reason', 'status', 'approved_at',
    'created_at', 'updated_at',
];

const COMMERCE_SETTLEMENT_FIELDS = [
    'platform', 'shop_id', 'account_id',
    'settlement_id', 'amount', 'currency', 'bank', 'status', 'processed_at',
    'created_at', 'updated_at',
];

// ---------------------------------------------------------------------------

// Coerce a marketplace amount ("12.500", 12500.0, "Rp12.500") to raw integer
// IDR. Returns null when it cannot be read as a number.
function toIntIDR(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? Math.round(value) : null;
    }
    const digits = String(value).replace(/[^\d-]/g, '');
    if (!digits || digits === '-') return null;
    const n = Number(digits);
    return Number.isFinite(n) ? Math.round(n) : null;
}

function _requireString(errors, obj, field, maxLen = 200) {
    const v = obj[field];
    if (typeof v !== 'string' || v.length === 0 || v.length > maxLen) {
        errors.push(`${field} must be a non-empty string (≤${maxLen})`);
    }
}

function _cleanMoney(errors, obj, fields, { required = [] } = {}) {
    const out = {};
    fields.forEach((f) => {
        const coerced = toIntIDR(obj[f]);
        if (coerced === null) {
            if (required.includes(f)) errors.push(`${f} is required and must be numeric`);
            out[f] = 0;
        } else {
            out[f] = coerced;
        }
    });
    return out;
}

// netRevenue ≈ grossRevenue − discount − fees − refund + shippingIncome − tax,
// tolerance ±1 (rounding). Invariant per Phase 0 review D5.
function checkNetRevenueInvariant(tx) {
    const expected = tx.grossRevenue - tx.discount - tx.commissionFee - tx.platformFee
        - tx.paymentFee - tx.affiliateFee - tx.refundAmount + tx.shippingIncome - tx.tax;
    return Math.abs(expected - tx.netRevenue) <= 1;
}

// Validate + clean a normalized commerce transaction produced by a connector's
// normalizer. Unknown keys are dropped (connector fields must not leak).
function validateCommerceTransaction(input) {
    const errors = [];
    const obj = input || {};
    _requireString(errors, obj, 'platform', 40);
    if (obj.platform && !PLATFORM_IDS.includes(obj.platform)) errors.push(`unknown platform '${obj.platform}'`);
    _requireString(errors, obj, 'shop_id', 120);
    _requireString(errors, obj, 'order_id', 160);
    const money = _cleanMoney(errors, obj, COMMERCE_TRANSACTION_MONEY_FIELDS, { required: ['grossRevenue', 'netRevenue'] });
    const value = {
        platform: obj.platform,
        shop_id: obj.shop_id,
        account_id: obj.account_id || `${obj.platform}_${obj.shop_id}`,
        order_id: obj.order_id,
        transaction_id: obj.transaction_id || obj.order_id,
        ...money,
        settlementDate: obj.settlementDate || null,
        currency: obj.currency || 'IDR',
        status: obj.status || 'unknown',
        ledger_status: obj.ledger_status || null,
        ledger_refs: obj.ledger_refs || null,
    };
    if (errors.length === 0 && !checkNetRevenueInvariant(value)) {
        errors.push('netRevenue invariant failed (gross − discount − fees − refund + shipping − tax ≠ net ± 1)');
    }
    return errors.length ? { ok: false, errors } : { ok: true, value };
}

function validateCommerceOrder(input) {
    const errors = [];
    const obj = input || {};
    _requireString(errors, obj, 'platform', 40);
    if (obj.platform && !PLATFORM_IDS.includes(obj.platform)) errors.push(`unknown platform '${obj.platform}'`);
    _requireString(errors, obj, 'shop_id', 120);
    _requireString(errors, obj, 'order_id', 160);
    if (obj.items !== undefined && !Array.isArray(obj.items)) errors.push('items must be an array');
    const money = _cleanMoney(errors, obj, [
        'subtotal', 'discount', 'voucher', 'shipping_fee', 'tax', 'marketplace_fee',
        'affiliate_fee', 'payment_fee', 'refund_amount', 'gross_sales', 'net_sales',
    ], { required: ['gross_sales'] });
    const status = ORDER_STATUSES.includes(obj.status) ? obj.status : 'unknown';
    const value = {
        platform: obj.platform,
        shop_id: obj.shop_id,
        account_id: obj.account_id || `${obj.platform}_${obj.shop_id}`,
        order_id: obj.order_id,
        order_number: obj.order_number || obj.order_id,
        customer: obj.customer || null,
        items: (obj.items || []).map((it) => ({
            sku: it.sku || null,
            name: it.name || null,
            quantity: Number(it.quantity) || 0,
            unit_price: toIntIDR(it.unit_price) || 0,
            subtotal: toIntIDR(it.subtotal) || 0,
        })),
        ...money,
        currency: obj.currency || 'IDR',
        status,
        order_created_at: obj.order_created_at || null,
        order_updated_at: obj.order_updated_at || null,
    };
    return errors.length ? { ok: false, errors } : { ok: true, value };
}

function validateCommerceRefund(input) {
    const errors = [];
    const obj = input || {};
    _requireString(errors, obj, 'platform', 40);
    _requireString(errors, obj, 'shop_id', 120);
    _requireString(errors, obj, 'refund_id', 160);
    _requireString(errors, obj, 'order_id', 160);
    const amount = toIntIDR(obj.amount);
    if (amount === null || amount < 0) errors.push('amount is required and must be a non-negative integer');
    const value = {
        platform: obj.platform,
        shop_id: obj.shop_id,
        account_id: obj.account_id || `${obj.platform}_${obj.shop_id}`,
        refund_id: obj.refund_id,
        order_id: obj.order_id,
        amount: amount || 0,
        reason: obj.reason ? String(obj.reason).slice(0, 500) : null,
        status: REFUND_STATUSES.includes(obj.status) ? obj.status : 'unknown',
        approved_at: obj.approved_at || null,
    };
    return errors.length ? { ok: false, errors } : { ok: true, value };
}

function validateCommerceSettlement(input) {
    const errors = [];
    const obj = input || {};
    _requireString(errors, obj, 'platform', 40);
    _requireString(errors, obj, 'shop_id', 120);
    _requireString(errors, obj, 'settlement_id', 160);
    const amount = toIntIDR(obj.amount);
    if (amount === null || amount < 0) errors.push('amount is required and must be a non-negative integer');
    const value = {
        platform: obj.platform,
        shop_id: obj.shop_id,
        account_id: obj.account_id || `${obj.platform}_${obj.shop_id}`,
        settlement_id: obj.settlement_id,
        amount: amount || 0,
        currency: obj.currency || 'IDR',
        bank: obj.bank ? String(obj.bank).slice(0, 120) : null,
        status: SETTLEMENT_STATUSES.includes(obj.status) ? obj.status : 'unknown',
        processed_at: obj.processed_at || null,
    };
    return errors.length ? { ok: false, errors } : { ok: true, value };
}

module.exports = {
    COMMERCE_TRANSACTION_FIELDS,
    COMMERCE_TRANSACTION_MONEY_FIELDS,
    COMMERCE_ORDER_FIELDS,
    COMMERCE_REFUND_FIELDS,
    COMMERCE_SETTLEMENT_FIELDS,
    ORDER_STATUSES,
    REFUND_STATUSES,
    SETTLEMENT_STATUSES,
    toIntIDR,
    checkNetRevenueInvariant,
    validateCommerceTransaction,
    validateCommerceOrder,
    validateCommerceRefund,
    validateCommerceSettlement,
};
