// =============================================================================
// Commerce Integration Platform — connector registry
//
// Every marketplace is a connector module in ./connectors/<platform>.js that
// implements the contract below (Phase 0 review D6). Nothing outside the
// connector layer may know which marketplace data came from.
//
// Connector contract:
//   {
//     id, displayName, category, authType,        // metadata
//     requiredEnv: [...],                          // config gate for isConfigured()
//     buildAuthUrl({ state, redirectUri }),        // redirect authTypes only
//     completeAuth({ query, body, redirectUri }),  // -> { tokens, shop, platformMeta }
//     refreshTokens({ credentials }),              // -> tokens
//     revoke({ credentials }),                     // best-effort
//     fetchOrders({ credentials, since, until, cursor }),      // -> { items, nextCursor }
//     fetchRefunds({ credentials, since, until, cursor }),
//     fetchSettlements({ credentials, since, until, cursor }),
//     verifyWebhook({ headers, rawBody, url }),    // -> { ok, shopId?, eventType? }
//     parseWebhookEvent(rawBody),                  // -> { shopId, eventType, occurredAt, orderIds }
//     normalizeOrder(raw), normalizeRefund(raw), normalizeSettlement(raw),
//   }
//
// Phase 3 adds connectors/mock.js (behind COMMERCE_MOCK_ENABLED); Phase 4+
// add tiktok_shop.js / shopee.js / tokopedia.js — one file + env vars each,
// no framework changes.
// =============================================================================

const { ENV, flagEnabled } = require('./constants');

// platform id -> lazy loader. Lazy so a broken/missing connector file only
// fails requests for that platform, and unregistered platforms cost nothing.
const CONNECTOR_LOADERS = {
    tiktok_shop: () => require('./connectors/tiktok-shop'),      // Phase 4
    // shopee:      () => require('./connectors/shopee'),        // Phase 5
    // tokopedia:   () => require('./connectors/tokopedia'),     // Phase 6
};

// The mock connector is only visible when explicitly enabled — never register
// it in production.
function _loaders() {
    const loaders = { ...CONNECTOR_LOADERS };
    if (flagEnabled(ENV.COMMERCE_MOCK_ENABLED)) {
        loaders.mock = () => require('./connectors/mock');
    }
    return loaders;
}

// Returns the connector module for a platform id, or null when unknown.
function get(platform) {
    const loader = _loaders()[platform];
    if (!loader) return null;
    return loader();
}

// All registered platform ids (mock included only when enabled).
function list() {
    return Object.keys(_loaders());
}

// True when every env var the connector needs is present. This is the Phase 4
// activation path: deploy the connector file, set its env vars, done.
function isConfigured(platform) {
    const connector = get(platform);
    if (!connector) return false;
    return (connector.requiredEnv || []).every((name) => !!process.env[name]);
}

module.exports = { get, list, isConfigured };
