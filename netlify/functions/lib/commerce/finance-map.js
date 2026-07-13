'use strict';

// =============================================================================
// Commerce Integration Platform — finance mapping engine
//
// Pure functions: normalized commerce records IN → FluxyOS ledger transaction
// payloads OUT. No I/O here; store.js writes the results with deterministic
// ids and create() idempotency. See docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md (D2).
//
// Decomposition per commerce transaction (order-level):
//   income entry  = grossRevenue − discount + shippingIncome − tax
//   fee entry     = commissionFee + platformFee + paymentFee + affiliateFee
//   refund entry  = refundAmount
//   ⇒ income − fee − refund = netRevenue (exactly the model invariant)
// Settlements map to a neutral cash movement (type 'transfer', cash_* fields)
// so revenue isn't double-counted when the payout lands.
//
// Ledger doc ids (idempotency keys):
//   cm_{platform}_{shopId}_{orderId}_rev | _fee | _rf
//   cm_{platform}_{shopId}_stl_{settlementId}
// =============================================================================

const { LEDGER_ID_PREFIX, LEDGER_SOURCE, LEDGER_CREATED_VIA } = require('./constants');

const PLATFORM_DISPLAY = {
    tiktok_shop: 'TikTok Shop',
    shopee: 'Shopee',
    tokopedia: 'Tokopedia',
    mock: 'Mock Marketplace',
};

function vendorName(platform, shopName) {
    const display = PLATFORM_DISPLAY[platform] || platform;
    return shopName ? `${display} — ${shopName}`.slice(0, 160) : display;
}

function baseFields(commerceTx, account, timestamp) {
    return {
        vendor_name: vendorName(commerceTx.platform, account && account.shop_name),
        status: 'Completed',
        timestamp,
        source: LEDGER_SOURCE,
        created_via: LEDGER_CREATED_VIA,
        commerce_order_id: `${commerceTx.platform}_${commerceTx.shop_id}_${commerceTx.order_id}`,
        commerce_account_id: commerceTx.account_id,
        // Journals are posted later by the existing client sweep
        // (postPendingJournals) — the bulk-import precedent. Never post here.
        accounting_status: 'pending',
    };
}

// Ledger payloads for one order-level commerce transaction. Only entries with
// amount > 0 are emitted (rules require positive integers). `timestamp` is the
// order time (Date) — store.js converts to a Firestore Timestamp.
function mapCommerceTransaction(commerceTx, { account = null, timestamp = new Date() } = {}) {
    const idBase = `${LEDGER_ID_PREFIX}_${commerceTx.platform}_${commerceTx.shop_id}_${commerceTx.order_id}`;
    const entries = [];

    const income = commerceTx.grossRevenue - commerceTx.discount + commerceTx.shippingIncome - commerceTx.tax;
    if (income > 0) {
        entries.push({
            id: `${idBase}_rev`,
            data: {
                ...baseFields(commerceTx, account, timestamp),
                amount: income,
                category: 'Revenue',
                type: 'income',
                icon: '💰',
            },
        });
    }

    const fees = commerceTx.commissionFee + commerceTx.platformFee + commerceTx.paymentFee + commerceTx.affiliateFee;
    if (fees > 0) {
        entries.push({
            id: `${idBase}_fee`,
            data: {
                ...baseFields(commerceTx, account, timestamp),
                amount: fees,
                category: 'Operations',
                type: 'fee',
                icon: '💸',
            },
        });
    }

    if (commerceTx.refundAmount > 0) {
        entries.push({
            id: `${idBase}_rf`,
            data: {
                ...baseFields(commerceTx, account, timestamp),
                amount: commerceTx.refundAmount,
                category: 'Revenue',
                type: 'refund',
                icon: '💸',
            },
        });
    }

    return entries;
}

// A settlement is the marketplace paying out already-recognized revenue —
// a cash movement, not new income. Neutral 'transfer' type + cash fields.
function mapSettlement(settlement, { account = null, timestamp = new Date() } = {}) {
    if (!(settlement.amount > 0)) return [];
    return [{
        id: `${LEDGER_ID_PREFIX}_${settlement.platform}_${settlement.shop_id}_stl_${settlement.settlement_id}`,
        data: {
            vendor_name: vendorName(settlement.platform, account && account.shop_name),
            status: 'Completed',
            timestamp,
            source: LEDGER_SOURCE,
            created_via: LEDGER_CREATED_VIA,
            commerce_order_id: null,
            commerce_account_id: settlement.account_id,
            accounting_status: 'excluded', // cash movement — no P&L journal
            amount: settlement.amount,
            category: 'Others',
            type: 'transfer',
            icon: '💰',
            cash_effective: true,
            cash_status: 'actual',
            cash_direction: 'in',
            cash_source: 'integration',
            cash_effective_at: timestamp,
            notes: settlement.bank ? `Marketplace settlement → ${settlement.bank}`.slice(0, 500) : 'Marketplace settlement',
        },
    }];
}

module.exports = { mapCommerceTransaction, mapSettlement, vendorName, PLATFORM_DISPLAY };
