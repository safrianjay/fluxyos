'use strict';

// =============================================================================
// Shopee connector — Shopee Open Platform v2
//
// Implements the D6 connector contract (docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md).
// Shopee is NOT OAuth2 — everything Shopee-specific is encoded here:
//
//  - Auth link itself is HMAC-signed: /api/v2/shop/auth_partner?partner_id&
//    timestamp&sign&redirect= ; Shopee appends `code` + `shop_id` to the
//    redirect URL. Our signed `state` rides ON the redirect URL as a query
//    param (the framework's callback verifies it before touching the code).
//    Codes expire in ~10 minutes.
//  - Token exchange /api/v2/auth/token/get → access_token (~4 HOURS) +
//    refresh_token (~30 days, SINGLE-USE: both rotate on refresh via
//    /api/v2/auth/access_token/get). The framework's transaction-locked
//    token manager exists precisely for this.
//  - Two signing schemes, both HMAC-SHA256(partner_key, base) hex in the URL:
//      public endpoints (auth):  base = partner_id + path + timestamp
//      shop endpoints:           base = partner_id + path + timestamp
//                                       + access_token + shop_id
//  - Order list is capped at 15-DAY windows (the background import chunks at
//    exactly 15 days). List returns order_sn only → a second batched
//    get_order_detail call (≤50 sn per call) fills the payload; COMPLETED
//    orders are further enriched from payment/get_escrow_detail (fees live
//    in escrow, not on the order) — same convergence model as TikTok:
//    fee-less first pass, `_fee` ledger entry created on a later re-sync.
//  - Webhook push signature = HMAC-SHA256(partner_key, url + '|' + rawBody)
//    in the Authorization header → verifyWebhook NEEDS the canonical url
//    (the receiver reconstructs it from COMMERCE_REDIRECT_BASE_URL).
//  - Amounts arrive as numbers in shop currency (IDR → integers already);
//    Math.round(Number(v)) everywhere, never the Indonesian-format parser.
//
// NOTE: field names follow current v2 docs; verify with a live smoke on the
// first real connect (fees/settlement mapping most likely to need touch-up).
// =============================================================================

const crypto = require('crypto');
const { ENV, AUTH_TYPES } = require('../constants');

const API_HOST = process.env.SHOPEE_API_HOST || 'https://partner.shopeemobile.com';
const PAGE_SIZE = 50;
const DETAIL_BATCH = 50;
// error strings Shopee returns for dead/invalid tokens → err.code 'auth'
const AUTH_ERROR_RE = /invalid_access_token|error_auth|invalid_token|token.*expired|error_permission/i;

function partnerId() { return process.env[ENV.SHOPEE_PARTNER_ID]; }
function partnerKey() { return process.env[ENV.SHOPEE_PARTNER_KEY]; }

function money(v) {
    const n = Number(v == null || v === '' ? 0 : v);
    return Number.isFinite(n) ? Math.round(n) : 0;
}

function ts() { return Math.floor(Date.now() / 1000); }
function toEpochSeconds(d) { return Math.floor((d instanceof Date ? d.getTime() : Number(d)) / 1000); }

function authError(message) {
    const e = new Error(message);
    e.code = 'auth';
    return e;
}

function signPublic(path, timestamp) {
    return crypto.createHmac('sha256', partnerKey())
        .update(`${partnerId()}${path}${timestamp}`).digest('hex');
}

function signShop(path, timestamp, accessToken, shopId) {
    return crypto.createHmac('sha256', partnerKey())
        .update(`${partnerId()}${path}${timestamp}${accessToken}${shopId}`).digest('hex');
}

// Public (auth) endpoints: POST JSON body, public signature in URL.
async function publicCall(path, body) {
    const timestamp = ts();
    const qs = new URLSearchParams({
        partner_id: partnerId(), timestamp: String(timestamp), sign: signPublic(path, timestamp),
    }).toString();
    const res = await fetch(`${API_HOST}${path}?${qs}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error) {
        const msg = `shopee ${path} → ${data.error}: ${data.message || res.status}`;
        if (AUTH_ERROR_RE.test(data.error) || AUTH_ERROR_RE.test(data.message || '')) throw authError(msg);
        throw new Error(msg);
    }
    return data;
}

// Shop-authenticated endpoints: shop signature + access_token + shop_id in URL.
async function shopCall({ method = 'GET', path, credentials, query = {}, body = null }) {
    const timestamp = ts();
    const shopId = credentials.shopId;
    const params = {
        partner_id: partnerId(),
        timestamp: String(timestamp),
        access_token: credentials.accessToken,
        shop_id: shopId,
        sign: signShop(path, timestamp, credentials.accessToken, shopId),
        ...query,
    };
    const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    const res = await fetch(`${API_HOST}${path}?${qs}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (data.error) {
        const msg = `shopee ${path} → ${data.error}: ${data.message || res.status}`;
        if (AUTH_ERROR_RE.test(data.error) || AUTH_ERROR_RE.test(data.message || '')) throw authError(msg);
        throw new Error(msg);
    }
    return data.response || {};
}

const ORDER_STATUS_MAP = {
    UNPAID: 'pending',
    INVOICE_PENDING: 'pending',
    READY_TO_SHIP: 'paid',
    PROCESSED: 'paid',
    RETRY_SHIP: 'paid',
    SHIPPED: 'shipped',
    TO_CONFIRM_RECEIVE: 'shipped',
    COMPLETED: 'completed',
    IN_CANCEL: 'cancelled',
    CANCELLED: 'cancelled',
    TO_RETURN: 'refunded',
};

const REFUND_STATUS_MAP = {
    REQUESTED: 'requested',
    PROCESSING: 'approved',
    ACCEPTED: 'approved',
    JUDGING: 'requested',
    REFUND_PAID: 'completed',
    CLOSED: 'rejected',
    CANCELLED: 'rejected',
    SELLER_DISPUTE: 'requested',
};

module.exports = {
    id: 'shopee',
    displayName: 'Shopee',
    category: 'commerce',
    authType: AUTH_TYPES.SIGNED_REDIRECT,
    requiredEnv: [ENV.SHOPEE_PARTNER_ID, ENV.SHOPEE_PARTNER_KEY],

    // The signed authorization link. Shopee appends ?code=&shop_id= to the
    // `redirect` URL — our state param is embedded IN that URL so the
    // framework callback can verify it (the redirect domain must be
    // registered in the Shopee Open Platform console).
    buildAuthUrl({ state, redirectUri }) {
        const path = '/api/v2/shop/auth_partner';
        const timestamp = ts();
        const redirect = `${redirectUri}${redirectUri.includes('?') ? '&' : '?'}state=${encodeURIComponent(state)}`;
        const qs = new URLSearchParams({
            partner_id: partnerId(),
            timestamp: String(timestamp),
            sign: signPublic(path, timestamp),
            redirect,
        }).toString();
        return `${API_HOST}${path}?${qs}`;
    },

    async completeAuth({ query }) {
        const code = query.code;
        const shopId = query.shop_id;
        if (!code || !shopId) throw authError('missing code or shop_id from shopee redirect');
        const tok = await publicCall('/api/v2/auth/token/get', {
            code,
            shop_id: Number(shopId),
            partner_id: Number(partnerId()),
        });
        const tokens = {
            accessToken: tok.access_token,
            refreshToken: tok.refresh_token,
            accessExpiresAt: Date.now() + (Number(tok.expire_in) || 4 * 3600) * 1000,
            refreshExpiresAt: Date.now() + 30 * 24 * 3600 * 1000,
        };
        // Shop profile for the account card.
        let shopName = null;
        let region = 'ID';
        try {
            const info = await shopCall({
                path: '/api/v2/shop/get_shop_info',
                credentials: { accessToken: tokens.accessToken, shopId: String(shopId) },
            });
            shopName = info.shop_name || null;
            region = info.region || 'ID';
        } catch (e) {
            console.warn('[shopee] get_shop_info failed (non-fatal)', e.message);
        }
        return {
            tokens,
            shop: { shopId: String(shopId), shopName, region, currency: region === 'ID' ? 'IDR' : 'IDR' },
            platformMeta: { region },
        };
    },

    // SINGLE-USE refresh token: Shopee rotates BOTH tokens on every refresh.
    // Must only ever be called under the token manager's transaction lock.
    async refreshTokens({ credentials }) {
        if (!credentials.refreshToken) throw authError('no refresh token stored');
        const tok = await publicCall('/api/v2/auth/access_token/get', {
            refresh_token: credentials.refreshToken,
            partner_id: Number(partnerId()),
            shop_id: Number(credentials.shopId),
        });
        return {
            accessToken: tok.access_token,
            refreshToken: tok.refresh_token, // rotated
            accessExpiresAt: Date.now() + (Number(tok.expire_in) || 4 * 3600) * 1000,
            refreshExpiresAt: Date.now() + 30 * 24 * 3600 * 1000,
        };
    },

    // Shopee has no API-side revoke; sellers de-authorize in the seller
    // console. Local credential deletion is the effective revoke.
    async revoke() { return { ok: true }; },

    async fetchOrders({ credentials, since, until, cursor }) {
        // List (order_sn only), 15-day window cap enforced by clamping.
        const timeFrom = toEpochSeconds(since);
        const timeTo = Math.min(toEpochSeconds(until), timeFrom + 15 * 24 * 3600);
        const list = await shopCall({
            path: '/api/v2/order/get_order_list',
            credentials,
            query: {
                time_range_field: 'update_time',
                time_from: timeFrom,
                time_to: timeTo,
                page_size: PAGE_SIZE,
                ...(cursor ? { cursor } : {}),
                response_optional_fields: 'order_status',
            },
        });
        const sns = (list.order_list || []).map((o) => o.order_sn);
        const items = [];
        // Detail in batches of ≤50 sn.
        for (let i = 0; i < sns.length; i += DETAIL_BATCH) {
            const detail = await shopCall({
                path: '/api/v2/order/get_order_detail',
                credentials,
                query: {
                    order_sn_list: sns.slice(i, i + DETAIL_BATCH).join(','),
                    response_optional_fields: [
                        'buyer_username', 'item_list', 'total_amount', 'currency',
                        'create_time', 'update_time', 'order_status', 'actual_shipping_fee',
                    ].join(','),
                },
            });
            items.push(...(detail.order_list || []));
        }
        // Escrow enrichment for completed orders (fees live in escrow).
        for (const order of items) {
            order._shop_id = credentials.shopId;
            if (order.order_status !== 'COMPLETED') { order._escrow = null; continue; }
            try {
                const escrow = await shopCall({
                    path: '/api/v2/payment/get_escrow_detail',
                    credentials,
                    query: { order_sn: order.order_sn },
                });
                order._escrow = escrow.order_income || null;
            } catch (e) {
                if (e.code === 'auth') throw e;
                order._escrow = null; // converges on a later re-sync
            }
        }
        return { items, nextCursor: list.more ? (list.next_cursor || null) : null };
    },

    async fetchRefunds({ credentials, since, until, cursor }) {
        const page = cursor ? Number(cursor) : 1;
        const data = await shopCall({
            path: '/api/v2/returns/get_return_list',
            credentials,
            query: {
                page_no: page,
                page_size: PAGE_SIZE,
                create_time_from: toEpochSeconds(since),
                create_time_to: toEpochSeconds(until),
            },
        });
        const items = (data.return || data.return_list || []).map((r) => ({ ...r, _shop_id: credentials.shopId }));
        return { items, nextCursor: data.more ? String(page + 1) : null };
    },

    // Local-seller payouts surface as wallet transactions (WITHDRAWAL_CREATED
    // etc.). Mapped conservatively: only completed withdrawals become
    // settlements. Cross-border payout endpoints differ — revisit at live smoke.
    async fetchSettlements({ credentials, since, until, cursor }) {
        const page = cursor ? Number(cursor) : 0;
        let data;
        try {
            data = await shopCall({
                path: '/api/v2/payment/get_wallet_transaction_list',
                credentials,
                query: {
                    page_no: page,
                    page_size: PAGE_SIZE,
                    create_time_from: toEpochSeconds(since),
                    create_time_to: toEpochSeconds(until),
                },
            });
        } catch (e) {
            if (e.code === 'auth') throw e;
            console.warn('[shopee] wallet transactions unavailable', e.message);
            return { items: [], nextCursor: null };
        }
        const items = (data.transaction_list || [])
            .filter((t) => /WITHDRAW/i.test(t.transaction_type || '') && /COMPLETED|SUCCESS/i.test(t.status || ''))
            .map((t) => ({ ...t, _shop_id: credentials.shopId }));
        return { items, nextCursor: data.more ? String(page + 1) : null };
    },

    // Push signature = HMAC-SHA256(partner_key, url + '|' + rawBody) hex.
    verifyWebhook({ headers, rawBody, url }) {
        const provided = headers.authorization || headers.Authorization;
        if (!provided || !partnerKey() || !url) return { ok: false };
        const expected = crypto.createHmac('sha256', partnerKey())
            .update(`${url}|${rawBody.toString('utf8')}`).digest('hex');
        const a = Buffer.from(String(provided));
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };
        let payload = {};
        try { payload = JSON.parse(rawBody.toString('utf8')); } catch (_) { return { ok: false }; }
        return { ok: true, shopId: String(payload.shop_id || ''), eventType: String(payload.code || '') };
    },

    parseWebhookEvent(rawBody) {
        const payload = JSON.parse(rawBody.toString('utf8'));
        const data = payload.data || {};
        const orderSn = data.ordersn || data.order_sn || null;
        return {
            shopId: String(payload.shop_id || ''),
            eventType: String(payload.code || ''),
            eventId: `${payload.shop_id}_${payload.code}_${payload.timestamp || ''}${orderSn ? `_${orderSn}` : ''}`,
            occurredAt: payload.timestamp ? Number(payload.timestamp) * 1000 : Date.now(),
            orderIds: orderSn ? [String(orderSn)] : [],
        };
    },

    normalizeOrder(raw) {
        const escrow = raw._escrow || {};
        const items = (raw.item_list || []).map((it) => ({
            sku: it.item_sku || it.model_sku || null,
            name: it.item_name || null,
            quantity: Number(it.model_quantity_purchased) || 1,
            unit_price: money(it.model_discounted_price || it.model_original_price),
            subtotal: money(it.model_discounted_price || it.model_original_price) * (Number(it.model_quantity_purchased) || 1),
        }));
        const itemGross = items.reduce((s, it) => s + it.subtotal, 0);
        const gross = itemGross || money(raw.total_amount);
        const discount = money(escrow.seller_discount) + money(escrow.voucher_from_seller);
        const marketplaceFee = money(escrow.commission_fee) + money(escrow.service_fee);
        const paymentFee = money(escrow.transaction_fee);
        const shippingIncome = money(escrow.buyer_paid_shipping_fee);
        const refundAmount = Math.abs(money(escrow.refund_amount));
        return {
            platform: 'shopee',
            shop_id: String(raw.shop_id || raw._shop_id || ''),
            order_id: String(raw.order_sn),
            order_number: String(raw.order_sn),
            customer: raw.buyer_username || null,
            items,
            subtotal: gross,
            discount,
            voucher: money(escrow.voucher_from_seller),
            shipping_fee: shippingIncome,
            tax: 0,
            marketplace_fee: marketplaceFee,
            affiliate_fee: 0,
            payment_fee: paymentFee,
            refund_amount: refundAmount,
            gross_sales: gross,
            net_sales: gross - discount - marketplaceFee - paymentFee - refundAmount + shippingIncome,
            currency: raw.currency || 'IDR',
            status: ORDER_STATUS_MAP[raw.order_status] || 'unknown',
            order_created_at: raw.create_time ? new Date(Number(raw.create_time) * 1000) : null,
            order_updated_at: raw.update_time ? new Date(Number(raw.update_time) * 1000) : null,
        };
    },

    normalizeRefund(raw) {
        return {
            platform: 'shopee',
            shop_id: String(raw.shop_id || raw._shop_id || ''),
            refund_id: String(raw.return_sn),
            order_id: String(raw.order_sn),
            amount: money(raw.refund_amount),
            reason: raw.reason || raw.text_reason || null,
            status: REFUND_STATUS_MAP[raw.status] || 'unknown',
            approved_at: raw.update_time ? new Date(Number(raw.update_time) * 1000) : null,
        };
    },

    normalizeSettlement(raw) {
        return {
            platform: 'shopee',
            shop_id: String(raw.shop_id || raw._shop_id || ''),
            settlement_id: String(raw.transaction_id),
            amount: Math.abs(money(raw.amount)),
            currency: raw.currency || 'IDR',
            bank: raw.bank_name || null,
            status: 'paid',
            processed_at: raw.create_time ? new Date(Number(raw.create_time) * 1000) : null,
        };
    },
};
