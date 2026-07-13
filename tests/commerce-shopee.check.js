'use strict';

// =============================================================================
// FluxyOS — Shopee connector fixture checks (Phase 5, no live API)
//
// Pure checks: the two HMAC signing schemes (deterministic vectors), the
// signed auth link with embedded state, the url|body webhook signature, and
// the normalizers feeding the canonical models + finance mapper (escrow
// enrichment path and the fee-less convergence path).
//
// Run: node tests/commerce-shopee.check.js
// =============================================================================

process.env.SHOPEE_PARTNER_ID = '2007777';
process.env.SHOPEE_PARTNER_KEY = 'shopeetestpartnerkey';

const assert = require('assert');
const path = require('path');
const nodeCrypto = require('crypto');
const LIB = path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'commerce');

const shopee = require(path.join(LIB, 'connectors', 'shopee'));
const models = require(path.join(LIB, 'models'));
const financeMap = require(path.join(LIB, 'finance-map'));
const { commerceTransactionFromOrder } = require(path.join(LIB, 'normalize'));

let passed = 0;
let failed = 0;
function check(label, fn) {
    try { fn(); passed += 1; console.log(`  PASS  ${label}`); }
    catch (e) { failed += 1; console.error(`  FAIL  ${label} → ${e.message}`); }
}

console.log('\n— contract & signed auth link —');
check('implements the D6 contract surface (signed_redirect)', () => {
    ['buildAuthUrl', 'completeAuth', 'refreshTokens', 'revoke', 'fetchOrders', 'fetchRefunds',
        'fetchSettlements', 'verifyWebhook', 'parseWebhookEvent', 'normalizeOrder',
        'normalizeRefund', 'normalizeSettlement'].forEach((m) => assert.strictEqual(typeof shopee[m], 'function', m));
    assert.strictEqual(shopee.id, 'shopee');
    assert.strictEqual(shopee.authType, 'signed_redirect');
    assert.deepStrictEqual(shopee.requiredEnv, ['SHOPEE_PARTNER_ID', 'SHOPEE_PARTNER_KEY']);
});
check('auth link is correctly HMAC-signed and embeds state in redirect', () => {
    const url = new URL(shopee.buildAuthUrl({
        state: 'st.xyz',
        redirectUri: 'https://dashboard.fluxyos.com/api/v1/commerce/callback/shopee',
    }));
    assert.strictEqual(url.pathname, '/api/v2/shop/auth_partner');
    assert.strictEqual(url.searchParams.get('partner_id'), '2007777');
    const timestamp = url.searchParams.get('timestamp');
    const expected = nodeCrypto.createHmac('sha256', 'shopeetestpartnerkey')
        .update(`2007777/api/v2/shop/auth_partner${timestamp}`).digest('hex');
    assert.strictEqual(url.searchParams.get('sign'), expected);
    const redirect = new URL(url.searchParams.get('redirect'));
    assert.strictEqual(redirect.searchParams.get('state'), 'st.xyz'); // state rides the redirect
});
check('registry exposes shopee, gated on env', () => {
    const registry = require(path.join(LIB, 'registry'));
    assert.ok(registry.list().includes('shopee'));
    assert.strictEqual(registry.isConfigured('shopee'), true);
    delete process.env.SHOPEE_PARTNER_KEY;
    assert.strictEqual(registry.isConfigured('shopee'), false);
    process.env.SHOPEE_PARTNER_KEY = 'shopeetestpartnerkey';
});

console.log('\n— webhook (url|body signature) —');
check('valid url|body HMAC accepted; wrong url rejected; parse works', () => {
    const url = 'https://dashboard.fluxyos.com/api/v1/commerce/webhooks/shopee';
    const body = Buffer.from(JSON.stringify({
        shop_id: 555777, code: 3, timestamp: 1752480000, data: { ordersn: '220714ABC123' },
    }));
    const sig = nodeCrypto.createHmac('sha256', 'shopeetestpartnerkey')
        .update(`${url}|${body.toString('utf8')}`).digest('hex');
    const ok = shopee.verifyWebhook({ headers: { authorization: sig }, rawBody: body, url });
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.shopId, '555777');
    // Same signature against a different URL must fail (proves url is bound).
    const wrongUrl = shopee.verifyWebhook({ headers: { authorization: sig }, rawBody: body, url: url + 'x' });
    assert.strictEqual(wrongUrl.ok, false);
    const missingUrl = shopee.verifyWebhook({ headers: { authorization: sig }, rawBody: body });
    assert.strictEqual(missingUrl.ok, false);
    const parsed = shopee.parseWebhookEvent(body);
    assert.deepStrictEqual(parsed.orderIds, ['220714ABC123']);
    assert.strictEqual(parsed.eventType, '3');
});

console.log('\n— normalizers → canonical models —');
// Escrow-enriched COMPLETED order (fees in order_income, amounts numeric IDR).
const RAW_ORDER = {
    order_sn: '220714ABC123',
    order_status: 'COMPLETED',
    create_time: 1752400000,
    update_time: 1752480000,
    buyer_username: 'budi88',
    currency: 'IDR',
    total_amount: 150000,
    item_list: [
        { item_sku: 'SKU-1', item_name: 'Kaos Polos', model_quantity_purchased: 2, model_discounted_price: 75000 },
    ],
    _shop_id: '555777',
    _escrow: {
        escrow_amount: 135500,
        commission_fee: 7000,
        service_fee: 2000,
        transaction_fee: 1500,
        seller_discount: 10000,
        voucher_from_seller: 0,
        buyer_paid_shipping_fee: 12000,
        refund_amount: 0,
    },
};
check('escrow-enriched order normalizes with correct fees', () => {
    const result = models.validateCommerceOrder(shopee.normalizeOrder(RAW_ORDER));
    assert.strictEqual(result.ok, true, (result.errors || []).join('; '));
    const o = result.value;
    assert.strictEqual(o.gross_sales, 150000);
    assert.strictEqual(o.discount, 10000);
    assert.strictEqual(o.marketplace_fee, 9000);   // commission + service
    assert.strictEqual(o.payment_fee, 1500);
    assert.strictEqual(o.shipping_fee, 12000);
    assert.strictEqual(o.net_sales, 150000 - 10000 - 9000 - 1500 + 12000);
    assert.strictEqual(o.status, 'completed');
    assert.strictEqual(o.shop_id, '555777');
});
check('order flows through tx derivation + finance mapping', () => {
    const order = models.validateCommerceOrder(shopee.normalizeOrder(RAW_ORDER)).value;
    const tx = commerceTransactionFromOrder(order);
    const entries = financeMap.mapCommerceTransaction(tx, { account: { shop_name: 'Toko Shopee' } });
    const byType = Object.fromEntries(entries.map((e) => [e.data.type, e]));
    assert.strictEqual(byType.income.data.amount, 152000);  // 150000 − 10000 + 12000 − 0
    assert.strictEqual(byType.fee.data.amount, 10500);      // 9000 + 1500
    assert.strictEqual(byType.income.data.amount - byType.fee.data.amount, tx.netRevenue);
    assert.strictEqual(byType.income.id, 'cm_shopee_555777_220714ABC123_rev');
    assert.strictEqual(byType.income.data.vendor_name, 'Shopee — Toko Shopee');
});
check('un-settled order (no escrow) is fee-less and converges later', () => {
    const raw = { ...RAW_ORDER, order_status: 'SHIPPED', _escrow: null };
    const order = models.validateCommerceOrder(shopee.normalizeOrder(raw)).value;
    assert.strictEqual(order.marketplace_fee, 0);
    const entries = financeMap.mapCommerceTransaction(commerceTransactionFromOrder(order), {});
    assert.strictEqual(entries.map((e) => e.data.type).join(','), 'income');
});
check('refund normalizes + validates', () => {
    const result = models.validateCommerceRefund(shopee.normalizeRefund({
        return_sn: 'RN9001', order_sn: '220714ABC123', _shop_id: '555777',
        refund_amount: 25000, status: 'REFUND_PAID', reason: 'DAMAGED', update_time: 1752480000,
    }));
    assert.strictEqual(result.ok, true, (result.errors || []).join('; '));
    assert.strictEqual(result.value.amount, 25000);
    assert.strictEqual(result.value.status, 'completed');
});
check('wallet withdrawal maps to a settlement cash movement', () => {
    const result = models.validateCommerceSettlement(shopee.normalizeSettlement({
        transaction_id: 88123, amount: -180000, currency: 'IDR', bank_name: 'BCA',
        transaction_type: 'WITHDRAWAL_COMPLETED', status: 'COMPLETED', create_time: 1752500000,
        _shop_id: '555777',
    }));
    assert.strictEqual(result.ok, true, (result.errors || []).join('; '));
    assert.strictEqual(result.value.amount, 180000); // absolute value
    const entries = financeMap.mapSettlement(result.value, {});
    assert.strictEqual(entries[0].id, 'cm_shopee_555777_stl_88123');
    assert.strictEqual(entries[0].data.cash_direction, 'in');
});

console.log(`\n──────── ${passed} passed, ${failed} failed ────────`);
process.exit(failed === 0 ? 0 : 1);
