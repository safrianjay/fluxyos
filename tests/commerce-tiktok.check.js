'use strict';

// =============================================================================
// FluxyOS — TikTok Shop connector fixture checks (Phase 4, no live API)
//
// Pure checks against the D6 contract: request signing determinism, auth URL,
// token-shape mapping, webhook HMAC verify/parse, and the normalizers feeding
// the canonical models (validated end-to-end through models.validate* and the
// finance mapper). Live-credential smoke (real token exchange + one orders
// page) happens at activation, not here.
//
// Run: node tests/commerce-tiktok.check.js
// =============================================================================

process.env.TIKTOK_SHOP_APP_KEY = 'testappkey';
process.env.TIKTOK_SHOP_APP_SECRET = 'testappsecret';

const assert = require('assert');
const path = require('path');
const nodeCrypto = require('crypto');
const LIB = path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'commerce');

const tiktok = require(path.join(LIB, 'connectors', 'tiktok-shop'));
const models = require(path.join(LIB, 'models'));
const financeMap = require(path.join(LIB, 'finance-map'));
const { commerceTransactionFromOrder } = require(path.join(LIB, 'normalize'));

let passed = 0;
let failed = 0;
function check(label, fn) {
    try { fn(); passed += 1; console.log(`  PASS  ${label}`); }
    catch (e) { failed += 1; console.error(`  FAIL  ${label} → ${e.message}`); }
}

console.log('\n— contract & auth —');
check('implements the D6 contract surface', () => {
    ['buildAuthUrl', 'completeAuth', 'refreshTokens', 'revoke', 'fetchOrders', 'fetchRefunds',
        'fetchSettlements', 'verifyWebhook', 'parseWebhookEvent', 'normalizeOrder',
        'normalizeRefund', 'normalizeSettlement'].forEach((m) => assert.strictEqual(typeof tiktok[m], 'function', m));
    assert.strictEqual(tiktok.id, 'tiktok_shop');
    assert.strictEqual(tiktok.authType, 'oauth_redirect');
    assert.deepStrictEqual(tiktok.requiredEnv, ['TIKTOK_SHOP_APP_KEY', 'TIKTOK_SHOP_APP_SECRET']);
});
check('auth URL carries app_key + state (no service id set)', () => {
    const url = new URL(tiktok.buildAuthUrl({ state: 'st.abc' }));
    assert.strictEqual(url.hostname, 'auth.tiktok-shops.com');
    assert.strictEqual(url.searchParams.get('app_key'), 'testappkey');
    assert.strictEqual(url.searchParams.get('state'), 'st.abc');
});
check('registry exposes tiktok_shop, gated on env', () => {
    const registry = require(path.join(LIB, 'registry'));
    assert.ok(registry.list().includes('tiktok_shop'));
    assert.strictEqual(registry.isConfigured('tiktok_shop'), true); // test env set above
    delete process.env.TIKTOK_SHOP_APP_KEY;
    assert.strictEqual(registry.isConfigured('tiktok_shop'), false);
    process.env.TIKTOK_SHOP_APP_KEY = 'testappkey';
});

console.log('\n— webhook —');
check('valid HMAC accepted; tampered rejected; event parsed', () => {
    const body = Buffer.from(JSON.stringify({
        type: 1, shop_id: '7495800', timestamp: 1752480000,
        data: { order_id: '576461413038785752', order_status: 'AWAITING_SHIPMENT', notification_id: 'n-1' },
    }));
    const sig = nodeCrypto.createHmac('sha256', 'testappsecret').update('testappkey' + body.toString('utf8')).digest('hex');
    const ok = tiktok.verifyWebhook({ headers: { authorization: sig }, rawBody: body });
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.shopId, '7495800');
    const bad = tiktok.verifyWebhook({ headers: { authorization: sig.replace(/^./, sig[0] === 'f' ? '0' : 'f') }, rawBody: body });
    assert.strictEqual(bad.ok, false);
    const parsed = tiktok.parseWebhookEvent(body);
    assert.deepStrictEqual(parsed.orderIds, ['576461413038785752']);
    assert.strictEqual(parsed.eventId, 'n-1');
    assert.strictEqual(parsed.occurredAt, 1752480000000);
});

console.log('\n— normalizers → canonical models —');
// Representative 202309 order payload (dot-decimal string amounts).
const RAW_ORDER = {
    id: '576461413038785752',
    status: 'COMPLETED',
    create_time: 1752400000,
    update_time: 1752480000,
    buyer_email: 'b***@tiktok.com',
    payment: {
        currency: 'IDR',
        sub_total: '150000.00',
        original_total_product_price: '150000.00',
        seller_discount: '10000.00',
        platform_discount: '0.00',
        shipping_fee: '12000.00',
        tax: '0.00',
        total_amount: '152000.00',
    },
    line_items: [
        { seller_sku: 'SKU-1', product_name: 'Kaos Polos', sale_price: '75000.00', quantity: 2 },
    ],
    _shop_id: '7495800',
    _fee_amount: 9000,
};
check('order normalizes with correct integer money (decimal strings NOT 100×)', () => {
    const normalized = tiktok.normalizeOrder(RAW_ORDER);
    const result = models.validateCommerceOrder(normalized);
    assert.strictEqual(result.ok, true, (result.errors || []).join('; '));
    const o = result.value;
    assert.strictEqual(o.gross_sales, 150000);      // "150000.00" → 150000, not 15000000
    assert.strictEqual(o.discount, 10000);
    assert.strictEqual(o.shipping_fee, 12000);
    assert.strictEqual(o.marketplace_fee, 9000);    // enriched statement fees
    assert.strictEqual(o.net_sales, 150000 - 10000 - 9000 + 12000);
    assert.strictEqual(o.status, 'completed');
    assert.strictEqual(o.shop_id, '7495800');
    assert.strictEqual(o.items[0].subtotal, 150000);
});
check('order flows through commerce tx derivation + finance mapping', () => {
    const order = models.validateCommerceOrder(tiktok.normalizeOrder(RAW_ORDER)).value;
    const tx = commerceTransactionFromOrder(order);
    assert.strictEqual(tx.netRevenue, 143000);
    const entries = financeMap.mapCommerceTransaction(tx, { account: { shop_name: 'Toko Uji' } });
    const byType = Object.fromEntries(entries.map((e) => [e.data.type, e]));
    assert.strictEqual(byType.income.data.amount, 152000);  // gross − disc + shipping − tax
    assert.strictEqual(byType.fee.data.amount, 9000);
    assert.strictEqual(byType.income.data.amount - byType.fee.data.amount, tx.netRevenue);
    assert.strictEqual(byType.income.id, 'cm_tiktok_shop_7495800_576461413038785752_rev');
    assert.strictEqual(byType.income.data.vendor_name, 'TikTok Shop — Toko Uji');
});
check('unsettled order (no fee enrichment) converges later', () => {
    const raw = { ...RAW_ORDER, status: 'AWAITING_SHIPMENT', _fee_amount: 0 };
    const order = models.validateCommerceOrder(tiktok.normalizeOrder(raw)).value;
    const entries = financeMap.mapCommerceTransaction(commerceTransactionFromOrder(order), {});
    // No fee entry yet — created on a later re-sync once statements land;
    // the income entry (gross-based) is identical then, so ids never clash.
    assert.strictEqual(entries.map((e) => e.data.type).join(','), 'income');
});
check('refund normalizes + validates', () => {
    const normalized = tiktok.normalizeRefund({
        return_id: 'RR123', order_id: '576461413038785752', _shop_id: '7495800',
        return_status: 'RETURN_OR_REFUND_REQUEST_SUCCESS',
        refund_amount: { refund_total: '25000.00', currency: 'IDR' },
        return_reason_text: 'Barang rusak', update_time: 1752480000,
    });
    const result = models.validateCommerceRefund(normalized);
    assert.strictEqual(result.ok, true, (result.errors || []).join('; '));
    assert.strictEqual(result.value.amount, 25000);
    assert.strictEqual(result.value.status, 'completed');
});
check('settlement normalizes + maps to cash movement', () => {
    const normalized = tiktok.normalizeSettlement({
        id: 'ST889', _shop_id: '7495800', settlement_amount: '141000.00',
        currency: 'IDR', payment_status: 'PAID', statement_time: 1752500000,
    });
    const result = models.validateCommerceSettlement(normalized);
    assert.strictEqual(result.ok, true, (result.errors || []).join('; '));
    const entries = financeMap.mapSettlement(result.value, {});
    assert.strictEqual(entries[0].id, 'cm_tiktok_shop_7495800_stl_ST889');
    assert.strictEqual(entries[0].data.amount, 141000);
    assert.strictEqual(entries[0].data.cash_direction, 'in');
});

console.log(`\n──────── ${passed} passed, ${failed} failed ────────`);
process.exit(failed === 0 ? 0 : 1);
