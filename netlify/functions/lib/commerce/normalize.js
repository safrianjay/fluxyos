'use strict';

// =============================================================================
// Commerce Integration Platform — normalization engine
//
// The single gate between connector output and storage: every raw marketplace
// record passes a connector's normalize*() and then THIS validation before
// anything is written. Rejects never reach commerce_* collections or the
// ledger — they become commerce_sync_errors entries instead.
// See docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md (layer 3, D5).
// =============================================================================

const {
    validateCommerceOrder,
    validateCommerceRefund,
    validateCommerceSettlement,
    validateCommerceTransaction,
} = require('./models');

const VALIDATORS = {
    order: validateCommerceOrder,
    refund: validateCommerceRefund,
    settlement: validateCommerceSettlement,
    transaction: validateCommerceTransaction,
};

// Normalize a batch of raw marketplace records through the connector, then
// validate against the canonical models. Returns { valid: [...], rejects:
// [{ raw_id, kind, errors }] }. A connector normalizer that throws rejects
// just that record, never the batch.
function normalizeBatch(connector, kind, rawItems, { accountId } = {}) {
    const normalizerName = { order: 'normalizeOrder', refund: 'normalizeRefund', settlement: 'normalizeSettlement' }[kind];
    const validate = VALIDATORS[kind];
    if (!normalizerName || !validate) throw new Error(`normalizeBatch: unknown kind '${kind}'`);

    const valid = [];
    const rejects = [];
    (rawItems || []).forEach((raw, index) => {
        let normalized;
        try {
            normalized = connector[normalizerName](raw);
        } catch (e) {
            rejects.push({ kind, raw_id: _rawId(raw, index), errors: [`normalizer threw: ${String(e.message).slice(0, 200)}`] });
            return;
        }
        if (accountId && normalized && !normalized.account_id) normalized.account_id = accountId;
        const result = validate(normalized);
        if (result.ok) valid.push(result.value);
        else rejects.push({ kind, raw_id: _rawId(raw, index), errors: result.errors });
    });
    return { valid, rejects };
}

// Derive the order-level commerce transaction (Universal model) from a
// normalized ORDER. Connectors don't produce these directly — the order is
// the source of truth and this derivation keeps the money math in one place.
function commerceTransactionFromOrder(order) {
    const result = validateCommerceTransaction({
        platform: order.platform,
        shop_id: order.shop_id,
        account_id: order.account_id,
        order_id: order.order_id,
        transaction_id: order.order_id,
        grossRevenue: order.gross_sales,
        discount: order.discount,
        shippingIncome: order.shipping_fee,
        commissionFee: order.marketplace_fee,
        platformFee: 0,
        paymentFee: order.payment_fee,
        affiliateFee: order.affiliate_fee,
        refundAmount: order.refund_amount,
        tax: order.tax,
        netRevenue: order.gross_sales - order.discount - order.marketplace_fee
            - order.payment_fee - order.affiliate_fee - order.refund_amount
            + order.shipping_fee - order.tax,
        currency: order.currency,
        status: order.status,
    });
    // The netRevenue above is derived from the same terms the invariant checks,
    // so validation can only fail on identity fields — surface loudly if so.
    if (!result.ok) throw new Error(`commerceTransactionFromOrder: ${result.errors.join('; ')}`);
    return result.value;
}

function _rawId(raw, index) {
    if (raw && typeof raw === 'object') {
        return String(raw.order_id || raw.order_sn || raw.refund_id || raw.settlement_id || raw.id || `row_${index}`).slice(0, 160);
    }
    return `row_${index}`;
}

module.exports = { normalizeBatch, commerceTransactionFromOrder };
