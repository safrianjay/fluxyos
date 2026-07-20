'use strict';

// =============================================================================
// TikTok Shop connector — TikTok Shop Open Platform, API version 202309
//
// Implements the D6 connector contract (docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md).
// Everything TikTok-specific lives HERE: auth URLs, the request-signing
// scheme, endpoint paths, response shapes, webhook signature, and the
// normalizers into the FluxyOS canonical models. Nothing outside this file
// knows it is talking to TikTok.
//
// Platform semantics this file encodes:
//  - Seller authorization: consent redirect → `code` + echoed `state` on the
//    app's registered redirect URI. Token exchange / refresh happen against
//    auth.tiktok-shops.com (UNSIGNED, app_key+app_secret as params).
//  - Access token ~7 days, refresh token long-lived; tokens are per-seller.
//  - Every Shop API call against open-api.tiktokglobalshop.com is
//    HMAC-SHA256-signed: sign over app_secret + path + sorted(query k+v,
//    excluding sign & access_token) + rawBody + app_secret; token goes in the
//    `x-tts-access-token` header; per-shop `shop_cipher` query param
//    (obtained once from /authorization/202309/shops, kept in platform_meta).
//  - Amounts are dot-decimal STRINGS in shop currency ("150000.00") — parsed
//    with Number(), NEVER models.toIntIDR (whose Indonesian-format dot
//    stripping would inflate them 100×).
//  - Marketplace fees are NOT on the order payload — they live in Finance
//    statement transactions. fetchOrders enriches settled orders from
//    /finance/202309/orders/{id}/statement_transactions; unsettled orders
//    normalize with fee 0 and CONVERGE on a later re-sync: the pipeline's
//    per-type deterministic ledger ids mean the missing `_fee` entry is
//    simply created once fees appear, while the `_rev` entry (gross-based)
//    never changes.
//  - Webhook signature: `Authorization` header = hex HMAC-SHA256(app_secret,
//    app_key + raw body).
//
// NOTE: field names follow the current 202309 docs; verify against a live
// partner-credential smoke test before first production sync (Phase 4 QA).
// =============================================================================

const crypto = require('crypto');
const { ENV, AUTH_TYPES } = require('../constants');

// Overridable for TikTok's SANDBOX (App Review demos): point these at
// auth-sandbox.tiktok-shops.com / open-api-sandbox.tiktokglobalshop.com.
const AUTH_HOST = process.env.TIKTOK_SHOP_AUTH_HOST || 'https://auth.tiktok-shops.com';
const API_HOST = process.env.TIKTOK_SHOP_API_HOST || 'https://open-api.tiktokglobalshop.com';
const PAGE_SIZE = 50;
// Token/authorization DEAD codes → err.code 'auth' (account genuinely expires,
// stop retrying — the seller must re-consent).
const AUTH_ERROR_CODES = new Set([105000, 105001, 105002, 105003, 106001, 36009009]);
// MISSING-SCOPE codes → err.code 'forbidden' (the token is fine; the app just
// wasn't granted this particular API's scope). Observed live 2026-07-20 on
// BOTH /authorization/202309/shops and /return_refund/202309/returns/search —
// 105005 is TikTok's generic "insufficient API scope" code, reused across
// endpoints, and TikTok returns it with HTTP 401 (same status as a dead
// token). It must NOT expire the account or abort orders/settlements sync —
// only the one endpoint's data is skipped. See pipeline.js per-fetch handling.
const SCOPE_ERROR_CODES = new Set([105005]);

function appKey() { return process.env[ENV.TIKTOK_SHOP_APP_KEY]; }
function appSecret() { return process.env[ENV.TIKTOK_SHOP_APP_SECRET]; }

// Dot-decimal string/number → raw integer (rounded). NOT Indonesian format.
function money(v) {
    const n = Number(v == null || v === '' ? 0 : v);
    return Number.isFinite(n) ? Math.round(n) : 0;
}

function toEpochSeconds(d) {
    return Math.floor((d instanceof Date ? d.getTime() : Number(d)) / 1000);
}

function authError(message) {
    const e = new Error(message);
    e.code = 'auth';
    return e;
}

function scopeError(message) {
    const e = new Error(message);
    e.code = 'forbidden';
    return e;
}

// ---- request signing --------------------------------------------------------

// sign = hex(HMAC-SHA256(secret, secret + path + Σ sorted(k+v) + body + secret))
// over all query params except `sign` and `access_token`.
function signRequest(path, query, rawBody) {
    const sorted = Object.keys(query)
        .filter((k) => k !== 'sign' && k !== 'access_token' && query[k] !== undefined && query[k] !== null)
        .sort()
        .map((k) => `${k}${query[k]}`)
        .join('');
    const base = `${appSecret()}${path}${sorted}${rawBody || ''}${appSecret()}`;
    return crypto.createHmac('sha256', appSecret()).update(base).digest('hex');
}

async function apiCall({ method, path, credentials, query = {}, body = null }) {
    const rawBody = body ? JSON.stringify(body) : '';
    const fullQuery = {
        app_key: appKey(),
        timestamp: String(Math.floor(Date.now() / 1000)),
        shop_cipher: credentials.platformMeta && credentials.platformMeta.shop_cipher,
        ...query,
    };
    fullQuery.sign = signRequest(path, fullQuery, rawBody);
    const qs = new URLSearchParams(
        Object.entries(fullQuery).filter(([, v]) => v !== undefined && v !== null)
    ).toString();

    const res = await fetch(`${API_HOST}${path}?${qs}`, {
        method,
        headers: {
            'content-type': 'application/json',
            'x-tts-access-token': credentials.accessToken,
        },
        body: body ? rawBody : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (data.code !== 0) {
        const msg = `tiktok ${path} → code ${data.code}: ${data.message || res.status}`;
        const code = Number(data.code);
        // Scope check FIRST: TikTok reuses HTTP 401 for missing-scope (105005)
        // the same as a dead token, so status alone can't disambiguate — the
        // JSON code is the source of truth. Only fall back to "401 with no
        // recognized code" (a network/edge-level auth failure) as auth.
        if (SCOPE_ERROR_CODES.has(code)) throw scopeError(msg);
        if (AUTH_ERROR_CODES.has(code) || res.status === 401) throw authError(msg);
        throw new Error(msg);
    }
    return data.data || {};
}

// ---- token endpoints (unsigned, auth host) ----------------------------------

async function tokenCall(path, params) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${AUTH_HOST}${path}?${qs}`, { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (data.code !== 0 || !data.data || !data.data.access_token) {
        throw authError(`tiktok token ${path} → code ${data.code}: ${data.message || res.status}`);
    }
    const t = data.data;
    return {
        accessToken: t.access_token,
        refreshToken: t.refresh_token || null,
        // *_expire_in are absolute epoch SECONDS.
        accessExpiresAt: t.access_token_expire_in ? Number(t.access_token_expire_in) * 1000 : null,
        refreshExpiresAt: t.refresh_token_expire_in ? Number(t.refresh_token_expire_in) * 1000 : null,
        sellerName: t.seller_name || null,
    };
}

module.exports = {
    id: 'tiktok_shop',
    displayName: 'TikTok Shop',
    category: 'commerce',
    authType: AUTH_TYPES.OAUTH_REDIRECT,
    requiredEnv: [ENV.TIKTOK_SHOP_APP_KEY, ENV.TIKTOK_SHOP_APP_SECRET],

    // Partner Center apps expose a service-id authorization link; the app_key
    // variant is the fallback. The redirect URI is registered app-side.
    buildAuthUrl({ state }) {
        const serviceId = process.env.TIKTOK_SHOP_SERVICE_ID;
        if (serviceId) {
            return `https://services.tiktokshop.com/open/authorize?service_id=${encodeURIComponent(serviceId)}&state=${encodeURIComponent(state)}`;
        }
        return `${AUTH_HOST}/oauth/authorize?app_key=${encodeURIComponent(appKey())}&state=${encodeURIComponent(state)}`;
    },

    async completeAuth({ query }) {
        const code = query.code || query.auth_code;
        if (!code) throw authError('missing authorization code');
        const tokens = await tokenCall('/api/v2/token/get', {
            app_key: appKey(),
            app_secret: appSecret(),
            auth_code: code,
            grant_type: 'authorized_code',
        });
        // Resolve the authorized shop (+ its cipher, required to sign every
        // subsequent call). Phase 4 scope: first authorized shop.
        const shopsData = await apiCall({
            method: 'GET',
            path: '/authorization/202309/shops',
            credentials: { accessToken: tokens.accessToken, platformMeta: {} },
        });
        const shop = (shopsData.shops || [])[0];
        if (!shop) throw new Error('tiktok authorization returned no shops');
        return {
            tokens,
            shop: {
                shopId: String(shop.id),
                shopName: shop.name || tokens.sellerName || null,
                region: shop.region || null,
                currency: shop.region === 'ID' ? 'IDR' : (shop.currency || 'IDR'),
            },
            platformMeta: { shop_cipher: shop.cipher, seller_type: shop.seller_type || null },
        };
    },

    async refreshTokens({ credentials }) {
        if (!credentials.refreshToken) throw authError('no refresh token stored');
        return tokenCall('/api/v2/token/refresh', {
            app_key: appKey(),
            app_secret: appSecret(),
            refresh_token: credentials.refreshToken,
            grant_type: 'refresh_token',
        });
    },

    // TikTok has no token-revoke endpoint; sellers de-authorize in Seller
    // Center. Local credential deletion (disconnect flow) is the real revoke.
    async revoke() { return { ok: true }; },

    async fetchOrders({ credentials, since, until, cursor }) {
        const data = await apiCall({
            method: 'POST',
            path: '/order/202309/orders/search',
            credentials,
            query: { page_size: PAGE_SIZE, ...(cursor ? { page_token: cursor } : {}) },
            body: {
                update_time_ge: toEpochSeconds(since),
                update_time_lt: toEpochSeconds(until),
            },
        });
        const orders = data.orders || [];
        // TikTok payloads don't carry shop_id (implicit in the credentials);
        // the canonical models require it — stamp it on every raw item.
        orders.forEach((o) => { o._shop_id = credentials.shopId; });
        // Enrich settled orders with their statement fees (not on the order
        // payload). Small sequential batches — page size caps the fanout.
        for (const order of orders) {
            if (order.status !== 'COMPLETED' && order.status !== 'DELIVERED') continue;
            try {
                const fin = await apiCall({
                    method: 'GET',
                    path: `/finance/202309/orders/${order.id}/statement_transactions`,
                    credentials,
                });
                const txs = fin.statement_transactions || [];
                order._fee_amount = txs.reduce((sum, t) => sum + Math.abs(money(t.fee_amount)), 0);
                order._settlement_amount = txs.reduce((sum, t) => sum + money(t.settlement_amount), 0);
            } catch (e) {
                if (e.code === 'auth') throw e;
                // Not settled yet / statement lag — fees converge on re-sync.
                order._fee_amount = 0;
            }
        }
        return { items: orders, nextCursor: data.next_page_token || null };
    },

    async fetchRefunds({ credentials, since, until, cursor }) {
        const data = await apiCall({
            method: 'POST',
            path: '/return_refund/202309/returns/search',
            credentials,
            query: { page_size: PAGE_SIZE, ...(cursor ? { page_token: cursor } : {}) },
            body: {
                update_time_ge: toEpochSeconds(since),
                update_time_lt: toEpochSeconds(until),
            },
        });
        const items = data.return_orders || [];
        items.forEach((r) => { r._shop_id = credentials.shopId; });
        return { items, nextCursor: data.next_page_token || null };
    },

    async fetchSettlements({ credentials, since, until, cursor }) {
        const data = await apiCall({
            method: 'GET',
            path: '/finance/202309/statements',
            credentials,
            query: {
                statement_time_ge: toEpochSeconds(since),
                statement_time_lt: toEpochSeconds(until),
                page_size: PAGE_SIZE,
                sort_field: 'statement_time',
                ...(cursor ? { page_token: cursor } : {}),
            },
        });
        const items = data.statements || [];
        items.forEach((s) => { s._shop_id = credentials.shopId; });
        return { items, nextCursor: data.next_page_token || null };
    },

    // Authorization header = hex HMAC-SHA256(app_secret, app_key + raw body).
    verifyWebhook({ headers, rawBody }) {
        const provided = headers.authorization || headers.Authorization;
        if (!provided || !appSecret()) return { ok: false };
        const expected = crypto.createHmac('sha256', appSecret())
            .update(appKey() + rawBody.toString('utf8'))
            .digest('hex');
        const a = Buffer.from(String(provided));
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };
        let payload = {};
        try { payload = JSON.parse(rawBody.toString('utf8')); } catch (_) { return { ok: false }; }
        return { ok: true, shopId: String(payload.shop_id || ''), eventType: String(payload.type || '') };
    },

    parseWebhookEvent(rawBody) {
        const payload = JSON.parse(rawBody.toString('utf8'));
        const data = payload.data || {};
        return {
            shopId: String(payload.shop_id || ''),
            eventType: String(payload.type || ''),
            eventId: data.notification_id || `${payload.shop_id}_${payload.type}_${payload.timestamp || ''}`,
            occurredAt: payload.timestamp ? Number(payload.timestamp) * 1000 : Date.now(),
            orderIds: data.order_id ? [String(data.order_id)] : [],
        };
    },

    normalizeOrder(raw) {
        const payment = raw.payment || {};
        const shopId = String(raw.shop_id || raw._shop_id || '');
        const gross = money(payment.original_total_product_price) || money(payment.sub_total) || money(payment.total_amount);
        const discount = money(payment.seller_discount) + money(payment.platform_discount);
        const shipping = money(payment.shipping_fee);
        const tax = money(payment.tax);
        const fees = money(raw._fee_amount);
        return {
            platform: 'tiktok_shop',
            shop_id: shopId,
            order_id: String(raw.id),
            order_number: String(raw.id),
            customer: raw.buyer_email || null,
            items: (raw.line_items || []).map((it) => ({
                sku: it.seller_sku || it.sku_id || null,
                name: it.product_name || null,
                quantity: Number(it.quantity) || 1,
                unit_price: money(it.sale_price),
                subtotal: money(it.sale_price) * (Number(it.quantity) || 1),
            })),
            subtotal: gross,
            discount,
            voucher: 0,
            shipping_fee: shipping,
            tax,
            marketplace_fee: fees,
            affiliate_fee: 0,
            payment_fee: 0,
            refund_amount: 0, // refunds arrive via return_refund search
            gross_sales: gross,
            net_sales: gross - discount - fees + shipping - tax,
            currency: payment.currency || 'IDR',
            status: ORDER_STATUS_MAP[raw.status] || 'unknown',
            order_created_at: raw.create_time ? new Date(Number(raw.create_time) * 1000) : null,
            order_updated_at: raw.update_time ? new Date(Number(raw.update_time) * 1000) : null,
        };
    },

    normalizeRefund(raw) {
        const refund = raw.refund_amount || {};
        return {
            platform: 'tiktok_shop',
            shop_id: String(raw.shop_id || raw._shop_id || ''),
            refund_id: String(raw.return_id),
            order_id: String(raw.order_id),
            amount: money(refund.refund_total),
            reason: raw.return_reason_text || raw.return_reason || null,
            status: REFUND_STATUS_MAP[raw.return_status] || 'unknown',
            approved_at: raw.update_time ? new Date(Number(raw.update_time) * 1000) : null,
        };
    },

    normalizeSettlement(raw) {
        return {
            platform: 'tiktok_shop',
            shop_id: String(raw.shop_id || raw._shop_id || ''),
            settlement_id: String(raw.id),
            amount: money(raw.settlement_amount),
            currency: raw.currency || 'IDR',
            bank: null, // bank account detail lives on /finance/202309/payments
            status: raw.payment_status === 'PAID' ? 'paid' : 'pending',
            processed_at: raw.statement_time ? new Date(Number(raw.statement_time) * 1000) : null,
        };
    },
};

const ORDER_STATUS_MAP = {
    UNPAID: 'pending',
    ON_HOLD: 'paid',
    AWAITING_SHIPMENT: 'paid',
    PARTIALLY_SHIPPING: 'shipped',
    AWAITING_COLLECTION: 'shipped',
    IN_TRANSIT: 'shipped',
    DELIVERED: 'shipped',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
};

const REFUND_STATUS_MAP = {
    RETURN_OR_REFUND_REQUEST_PENDING: 'requested',
    REFUND_OR_RETURN_REQUEST_REJECT: 'rejected',
    AWAITING_BUYER_SHIP: 'approved',
    BUYER_SHIPPED_ITEM: 'approved',
    REJECT_RECEIVE_PACKAGE: 'rejected',
    RETURN_OR_REFUND_REQUEST_SUCCESS: 'completed',
    RETURN_OR_REFUND_REQUEST_CANCEL: 'rejected',
    RETURN_OR_REFUND_REQUEST_COMPLETE: 'completed',
};
