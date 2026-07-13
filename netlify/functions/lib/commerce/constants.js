// =============================================================================
// Commerce Integration Platform — shared constants (backend)
//
// Single source of truth for platform ids, statuses, job types, and env var
// names used across the connector framework (lib/commerce/*), the API function
// (commerce.js), the webhook receiver, and the sync worker/background/reconcile
// functions. See docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md (D1–D6).
// =============================================================================

// Registry keys. MUST equal commerce_accounts.platform and the {platform}
// segment of deterministic doc ids ({platform}_{shopId}_...).
const PLATFORMS = {
    TIKTOK_SHOP: 'tiktok_shop',
    SHOPEE: 'shopee',
    TOKOPEDIA: 'tokopedia',
    MOCK: 'mock', // fixture connector; registered only when COMMERCE_MOCK_ENABLED
};

// How a platform's connect flow works (Phase 0 review §2).
const AUTH_TYPES = {
    OAUTH_REDIRECT: 'oauth_redirect',     // TikTok Shop: seller consent redirect
    SIGNED_REDIRECT: 'signed_redirect',   // Shopee: HMAC-signed auth URL redirect
    CREDENTIALS_FORM: 'credentials_form', // Tokopedia: client-credentials + shop picker
};

// commerce_accounts.status (client-readable; server-written except auto_post).
const ACCOUNT_STATUSES = ['connecting', 'connected', 'expired', 'error', 'disconnected'];

// commerce_accounts.sync_health
const SYNC_HEALTH = ['healthy', 'degraded', 'failing'];

// commerce_sync_jobs.type
const JOB_TYPES = ['initial', 'incremental', 'manual', 'webhook', 'reconcile'];

// commerce_sync_jobs.status — pending → processing → done | failed(→pending on
// retry) | dead. Mirrors the digest-broadcast-worker claim/drain transitions.
const JOB_STATUSES = ['pending', 'processing', 'done', 'failed', 'dead'];

// Retry policy (D5): exponential backoff, base 60s, jitter added by jobs.js.
const JOB_MAX_ATTEMPTS = 5;
const JOB_BACKOFF_BASE_MS = 60 * 1000;

// commerce_transactions.ledger_status — 'posted' once finance mapping wrote the
// ledger entries; 'pending_review' when the account has auto_post=false.
const LEDGER_STATUSES = ['posted', 'pending_review', 'skipped', 'error'];

// Ledger doc id prefixes (D2). Deterministic:
//   cm_{platform}_{shopId}_{orderId}_rev|_fee|_rf
//   cm_{platform}_{shopId}_stl_{settlementId}
const LEDGER_ID_PREFIX = 'cm';

// Values stamped onto ledger `transactions` docs written by the sync worker.
const LEDGER_SOURCE = 'commerce';
const LEDGER_CREATED_VIA = 'integration';

// Audit log actions (names per docs/SECURITY_SYSTEM.md).
const AUDIT_ACTIONS = {
    CONNECT: 'integration.connect',
    DISCONNECT: 'integration.disconnect',
    SYNC: 'integration.sync',
    TOKEN_REFRESH: 'integration.token_refresh',
    SYNC_FAILURE: 'integration.sync_failure',
};
const AUDIT_SOURCE = 'integration';

// Environment variables (Phase 0 review §5). All flags default OFF.
const ENV = {
    // kill switches
    COMMERCE_ENABLED: 'COMMERCE_ENABLED',                 // commerce.js API routes
    COMMERCE_SYNC_ENABLED: 'COMMERCE_SYNC_ENABLED',       // crons + background worker
    COMMERCE_WEBHOOKS_ENABLED: 'COMMERCE_WEBHOOKS_ENABLED',
    COMMERCE_MOCK_ENABLED: 'COMMERCE_MOCK_ENABLED',
    // secrets / config
    COMMERCE_TOKEN_KEY: 'COMMERCE_TOKEN_KEY',             // base64 32-byte AES-256-GCM key
    COMMERCE_TOKEN_KEY_PREVIOUS: 'COMMERCE_TOKEN_KEY_PREVIOUS',
    COMMERCE_STATE_SECRET: 'COMMERCE_STATE_SECRET',       // HMAC key for OAuth state
    COMMERCE_REDIRECT_BASE_URL: 'COMMERCE_REDIRECT_BASE_URL', // e.g. https://dashboard.fluxyos.com
    // platform credentials
    TIKTOK_SHOP_APP_KEY: 'TIKTOK_SHOP_APP_KEY',
    TIKTOK_SHOP_APP_SECRET: 'TIKTOK_SHOP_APP_SECRET',
    SHOPEE_PARTNER_ID: 'SHOPEE_PARTNER_ID',
    SHOPEE_PARTNER_KEY: 'SHOPEE_PARTNER_KEY',
    TOKOPEDIA_CLIENT_ID: 'TOKOPEDIA_CLIENT_ID',
    TOKOPEDIA_CLIENT_SECRET: 'TOKOPEDIA_CLIENT_SECRET',
    TOKOPEDIA_FS_ID: 'TOKOPEDIA_FS_ID',
};

function flagEnabled(name) {
    return process.env[name] === 'true';
}

// Deterministic doc ids (structural duplicate detection — D5).
function accountId(platform, shopId) {
    return `${platform}_${shopId}`;
}
function orderDocId(platform, shopId, orderId) {
    return `${platform}_${shopId}_${orderId}`;
}
function settlementDocId(platform, shopId, settlementId) {
    return `${platform}_${shopId}_stl_${settlementId}`;
}
function credentialsDocId(workspaceId, platform, shopId) {
    return `${workspaceId}__${platform}_${shopId}`;
}

module.exports = {
    PLATFORMS,
    AUTH_TYPES,
    ACCOUNT_STATUSES,
    SYNC_HEALTH,
    JOB_TYPES,
    JOB_STATUSES,
    JOB_MAX_ATTEMPTS,
    JOB_BACKOFF_BASE_MS,
    LEDGER_STATUSES,
    LEDGER_ID_PREFIX,
    LEDGER_SOURCE,
    LEDGER_CREATED_VIA,
    AUDIT_ACTIONS,
    AUDIT_SOURCE,
    ENV,
    flagEnabled,
    accountId,
    orderDocId,
    settlementDocId,
    credentialsDocId,
};
