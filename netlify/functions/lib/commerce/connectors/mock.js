'use strict';

// =============================================================================
// Mock connector — deterministic fixtures that exercise the ENTIRE pipeline
// (OAuth-redirect shape, token refresh w/ rotation, orders/refunds/settlements,
// HMAC webhooks) without any marketplace. Registered ONLY when
// COMMERCE_MOCK_ENABLED === 'true' (never in production). Implements the full
// connector contract (Phase 0 review D6) so Phase 4 connectors are drop-in.
//
// Determinism: fixtures are keyed off the day window requested, so re-syncs
// produce the same order ids — which is exactly what the deterministic-id
// duplicate detection needs to prove idempotency end to end.
// =============================================================================

const crypto = require('crypto');

const MOCK_SHOP = { shopId: 'mockshop01', shopName: 'Toko Mock', region: 'ID', currency: 'IDR' };
const WEBHOOK_SECRET = 'mock-webhook-secret';

function dayKey(date) {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}

// Two orders per day in the window: one completed (fees + shipping), one with
// a partial refund. Amounts are integer IDR and internally consistent.
function ordersForDay(day) {
    return [
        {
            id: `MO-${day}-1`,
            buyer: 'Budi',
            item_list: [{ sku: 'SKU-1', name: 'Kaos Polos', qty: 2, price: 75000 }],
            total: 150000, discount: 10000, shipping: 12000, tax: 0,
            commission: 7000, service_fee: 2000, payment_fee: 1500, affiliate: 0,
            refund: 0, state: 'COMPLETED', created: `${day}T03:00:00Z`,
        },
        {
            id: `MO-${day}-2`,
            buyer: 'Sari',
            item_list: [{ sku: 'SKU-2', name: 'Topi Hitam', qty: 1, price: 90000 }],
            total: 90000, discount: 0, shipping: 10000, tax: 0,
            commission: 4200, service_fee: 1200, payment_fee: 900, affiliate: 500,
            refund: 25000, state: 'COMPLETED', created: `${day}T07:30:00Z`,
        },
    ];
}

function eachDay(since, until, fn) {
    const out = [];
    const cur = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
    while (cur <= until) {
        out.push(...fn(dayKey(cur), new Date(cur)));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
}

module.exports = {
    id: 'mock',
    displayName: 'Mock Marketplace',
    category: 'commerce',
    authType: 'oauth_redirect',
    requiredEnv: [], // always "configured" once registered

    buildAuthUrl({ state, redirectUri }) {
        // Loops straight back to our callback with a fixed code — lets the
        // full connect→callback→initial-sync flow run against localhost.
        const url = new URL(redirectUri);
        url.searchParams.set('code', 'mock-auth-code');
        url.searchParams.set('state', state);
        return url.toString();
    },

    async completeAuth({ query }) {
        if (query.code !== 'mock-auth-code') {
            const e = new Error('invalid mock auth code');
            e.code = 'auth';
            throw e;
        }
        return {
            tokens: {
                accessToken: `mock-access-${Date.now()}`,
                refreshToken: `mock-refresh-${Date.now()}`,
                accessExpiresAt: Date.now() + 4 * 3600 * 1000,
                refreshExpiresAt: Date.now() + 30 * 24 * 3600 * 1000,
            },
            shop: { ...MOCK_SHOP },
            platformMeta: { note: 'mock' },
        };
    },

    async refreshTokens({ credentials }) {
        if (!credentials.refreshToken || !String(credentials.refreshToken).startsWith('mock-refresh-')) {
            const e = new Error('mock refresh token invalid');
            e.code = 'auth';
            throw e;
        }
        // Rotates BOTH tokens like Shopee — exercises the rotation path.
        return {
            accessToken: `mock-access-${Date.now()}`,
            refreshToken: `mock-refresh-${Date.now()}`,
            accessExpiresAt: Date.now() + 4 * 3600 * 1000,
            refreshExpiresAt: Date.now() + 30 * 24 * 3600 * 1000,
        };
    },

    async revoke() { return { ok: true }; },

    async fetchOrders({ since, until }) {
        return { items: eachDay(since, until, (day) => ordersForDay(day)), nextCursor: null };
    },

    async fetchRefunds({ since, until }) {
        const items = eachDay(since, until, (day) => ([{
            refund_sn: `MR-${day}-2`, order_ref: `MO-${day}-2`, value: 25000,
            why: 'Barang rusak', state: 'COMPLETED', approved: `${day}T10:00:00Z`,
        }]));
        return { items, nextCursor: null };
    },

    async fetchSettlements({ since, until }) {
        const items = eachDay(since, until, (day) => ([{
            payout_id: `MS-${day}`, net: 180000, bank_name: 'BCA', state: 'PAID',
            paid_at: `${day}T15:00:00Z`,
        }]));
        return { items, nextCursor: null };
    },

    verifyWebhook({ headers, rawBody }) {
        const provided = headers['x-mock-signature'] || headers['X-Mock-Signature'];
        const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
        if (!provided || !crypto.timingSafeEqual(Buffer.from(String(provided)), Buffer.from(expected))) {
            return { ok: false };
        }
        let payload = {};
        try { payload = JSON.parse(rawBody.toString('utf8')); } catch (_) { return { ok: false }; }
        return { ok: true, shopId: payload.shop_id, eventType: payload.event };
    },

    parseWebhookEvent(rawBody) {
        const payload = JSON.parse(rawBody.toString('utf8'));
        return {
            shopId: payload.shop_id,
            eventType: payload.event,
            eventId: payload.event_id || null,
            occurredAt: payload.ts || Date.now(),
            orderIds: payload.order_ids || [],
        };
    },

    normalizeOrder(raw) {
        return {
            platform: 'mock',
            shop_id: MOCK_SHOP.shopId,
            order_id: raw.id,
            order_number: raw.id,
            customer: raw.buyer || null,
            items: (raw.item_list || []).map((it) => ({
                sku: it.sku, name: it.name, quantity: it.qty, unit_price: it.price,
                subtotal: it.qty * it.price,
            })),
            subtotal: raw.total,
            discount: raw.discount,
            voucher: 0,
            shipping_fee: raw.shipping,
            tax: raw.tax,
            marketplace_fee: raw.commission + raw.service_fee,
            affiliate_fee: raw.affiliate,
            payment_fee: raw.payment_fee,
            refund_amount: raw.refund,
            gross_sales: raw.total,
            net_sales: raw.total - raw.discount - (raw.commission + raw.service_fee)
                - raw.payment_fee - raw.affiliate - raw.refund + raw.shipping - raw.tax,
            currency: 'IDR',
            status: raw.state === 'COMPLETED' ? 'completed' : 'unknown',
            order_created_at: raw.created,
        };
    },

    normalizeRefund(raw) {
        return {
            platform: 'mock',
            shop_id: MOCK_SHOP.shopId,
            refund_id: raw.refund_sn,
            order_id: raw.order_ref,
            amount: raw.value,
            reason: raw.why,
            status: raw.state === 'COMPLETED' ? 'completed' : 'unknown',
            approved_at: raw.approved,
        };
    },

    normalizeSettlement(raw) {
        return {
            platform: 'mock',
            shop_id: MOCK_SHOP.shopId,
            settlement_id: raw.payout_id,
            amount: raw.net,
            bank: raw.bank_name,
            status: raw.state === 'PAID' ? 'paid' : 'unknown',
            processed_at: raw.paid_at,
        };
    },

    // exported for tests
    _WEBHOOK_SECRET: WEBHOOK_SECRET,
    _MOCK_SHOP: MOCK_SHOP,
};
