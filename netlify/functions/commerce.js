'use strict';

// =============================================================================
// Commerce Integration Platform — API function (/api/v1/commerce/*)
//
// Separate from api.js on purpose: this function needs the Admin SDK
// (credentials writes, job enqueue, directory writes), hosts an
// UNAUTHENTICATED browser GET (the OAuth callback, validated by a signed
// state), and has its own kill switch + cold-start isolation.
//
// Routes (netlify.toml maps /api/v1/commerce/* here, before the /api/v1/*
// catch-all; the webhook receiver is its own function):
//   POST /connect/{platform}    auth + integrations.manage → {auth_url} | inline connect
//   GET  /callback/{platform}   signed state → token exchange → 302 /integration
//   POST /disconnect            auth + integrations.manage
//   POST /sync-now              auth + integrations.manage (throttled)
//
// Every route 503s unless COMMERCE_ENABLED === 'true'.
// See docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md (D3).
// =============================================================================

const admin = require('firebase-admin');
const { initAdmin } = require('./lib/notify-core');
const registry = require('./lib/commerce/registry');
const { signState, verifyState } = require('./lib/commerce/crypto');
const tokenManager = require('./lib/commerce/token-manager');
const store = require('./lib/commerce/store');
const { enqueueJob, hasActiveJob } = require('./lib/commerce/jobs');
const { ENV, flagEnabled, accountId: makeAccountId, AUDIT_ACTIONS, AUTH_TYPES } = require('./lib/commerce/constants');

const ALLOWED_ORIGINS = [
    'https://fluxyos.com',
    'https://dashboard.fluxyos.com',
    'https://www.fluxyos.com',
    'http://localhost:8000',
    'http://localhost:8888',
    'http://127.0.0.1:8765',
];

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json',
        'Vary': 'Origin',
    };
}

function json(statusCode, body, headers) {
    return { statusCode, headers, body: JSON.stringify(body) };
}

function redirectBase() {
    return (process.env[ENV.COMMERCE_REDIRECT_BASE_URL] || 'https://dashboard.fluxyos.com').replace(/\/$/, '');
}

function callbackUri(platform) {
    return `${redirectBase()}/api/v1/commerce/callback/${platform}`;
}

function integrationRedirect(params) {
    const qs = new URLSearchParams(params).toString();
    return { statusCode: 302, headers: { Location: `${redirectBase()}/integration?${qs}` }, body: '' };
}

// Cryptographic ID-token verification (we have the Admin SDK — no need for
// api.js's Identity-Toolkit lookup).
async function verifyCaller(event) {
    const header = event.headers.authorization || event.headers.Authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return null;
    try {
        return await admin.auth().verifyIdToken(token);
    } catch (_) {
        return null;
    }
}

// integrations.manage ⇔ owner/admin membership, verified SERVER-side against
// the workspace the caller names (never trusted blindly).
async function requireManagerRole(db, uid, workspaceId) {
    if (!workspaceId) return null;
    const snap = await db.doc(`workspaces/${workspaceId}/members/${uid}`).get();
    if (!snap.exists) return null;
    const member = snap.data();
    if (member.status !== 'active' || !['owner', 'admin'].includes(member.role)) return null;
    return member;
}

exports.handler = async (event) => {
    const origin = event.headers.origin || event.headers.Origin || '';
    const headers = corsHeaders(origin);
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

    if (!flagEnabled(ENV.COMMERCE_ENABLED)) {
        return json(503, { error: 'commerce integrations are not enabled' }, headers);
    }

    const db = initAdmin();
    const path = event.path
        .replace('/.netlify/functions/commerce', '')
        .replace('/api/v1/commerce', '') || '/';
    const method = event.httpMethod;

    try {
        // ---- OAuth callback (unauthenticated GET; signed state is the auth) ----
        const callbackMatch = path.match(/^\/callback\/([a-z_]+)$/);
        if (callbackMatch && method === 'GET') {
            return await handleCallback(db, callbackMatch[1], event.queryStringParameters || {});
        }

        const connectMatch = path.match(/^\/connect\/([a-z_]+)$/);
        if (connectMatch && method === 'POST') {
            return await handleConnect(db, event, connectMatch[1], headers);
        }
        if (path === '/disconnect' && method === 'POST') {
            return await handleDisconnect(db, event, headers);
        }
        if (path === '/sync-now' && method === 'POST') {
            return await handleSyncNow(db, event, headers);
        }
        if (path === '/internal/install-credentials' && method === 'POST') {
            return await handleInstallCredentials(db, event, headers);
        }
        return json(404, { error: 'not found' }, headers);
    } catch (e) {
        console.error('[commerce] unhandled', e.message);
        return json(500, { error: 'internal error' }, headers);
    }
};

async function handleConnect(db, event, platform, headers) {
    const caller = await verifyCaller(event);
    if (!caller) return json(401, { error: 'unauthorized' }, headers);
    const body = safeJson(event.body);
    const workspaceId = body.workspace_id;
    const member = await requireManagerRole(db, caller.uid, workspaceId);
    if (!member) return json(403, { error: 'requires owner or admin role' }, headers);

    const connector = registry.get(platform);
    if (!connector) return json(404, { error: `unknown platform '${platform}'` }, headers);
    if (!registry.isConfigured(platform)) {
        return json(409, { error: `platform '${platform}' is not configured on this environment` }, headers);
    }

    if (connector.authType === AUTH_TYPES.CREDENTIALS_FORM) {
        // Tokopedia-style: no seller redirect — complete the connect inline
        // from the submitted shop id.
        const result = await connector.completeAuth({ body, redirectUri: callbackUri(platform) });
        await finishConnect(db, { workspaceId, platform, uid: caller.uid, result });
        return json(200, { connected: true }, headers);
    }

    const { state, nonce } = signState({ uid: caller.uid, workspaceId, platform });
    // Persist the nonce hash for single-use verification at the callback.
    await db.doc(`commerce_oauth_nonces/${nonce}`).set({
        workspace_id: workspaceId,
        platform,
        uid: caller.uid,
        used: false,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    const authUrl = connector.buildAuthUrl({ state, redirectUri: callbackUri(platform) });
    return json(200, { auth_url: authUrl }, headers);
}

async function handleCallback(db, platform, query) {
    const connector = registry.get(platform);
    if (!connector) return integrationRedirect({ error: 'unknown_platform' });

    const check = verifyState(query.state);
    if (!check.ok) return integrationRedirect({ error: `state_${check.reason}` });
    const { uid, ws: workspaceId, platform: statePlatform, nonce } = check.payload;
    if (statePlatform !== platform) return integrationRedirect({ error: 'state_platform_mismatch' });

    // Single-use nonce: flip used=false→true in a transaction.
    const nonceRef = db.doc(`commerce_oauth_nonces/${nonce}`);
    const nonceOk = await db.runTransaction(async (tx) => {
        const snap = await tx.get(nonceRef);
        if (!snap.exists || snap.get('used') === true) return false;
        tx.update(nonceRef, { used: true, used_at: admin.firestore.FieldValue.serverTimestamp() });
        return true;
    });
    if (!nonceOk) return integrationRedirect({ error: 'state_replayed' });

    try {
        const result = await connector.completeAuth({ query, redirectUri: callbackUri(platform) });
        await finishConnect(db, { workspaceId, platform, uid, result });
        return integrationRedirect({ connected: platform });
    } catch (e) {
        console.error('[commerce] callback failed', platform, e.message);
        return integrationRedirect({ error: 'exchange_failed' });
    }
}

// Shared tail of both connect flows: credentials → account doc → directory →
// initial sync job → audit.
async function finishConnect(db, { workspaceId, platform, uid, result }) {
    const { tokens, shop, platformMeta } = result;
    const accId = makeAccountId(platform, shop.shopId);

    await tokenManager.storeCredentials(db, {
        workspaceId,
        accountId: accId,
        platform,
        shopId: shop.shopId,
        tokens,
        platformMeta,
    });
    await store.upsertAccount(db, workspaceId, {
        platform,
        shop_id: shop.shopId,
        shop_name: shop.shopName || null,
        region: shop.region || null,
        currency: shop.currency || 'IDR',
        status: 'connected',
        last_sync_at: null,
        last_sync_status: null,
        sync_health: null,
        initial_sync: { status: 'pending', progress_pct: 0 },
        token_expires_at: tokens.accessExpiresAt ? admin.firestore.Timestamp.fromMillis(Number(new Date(tokens.accessExpiresAt))) : null,
        auto_post: true,
        connected_by: uid,
        connected_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    await store.setShopDirectory(db, { platform, shopId: shop.shopId, workspaceId, accountId: accId });
    await enqueueJob(db, workspaceId, {
        accountId: accId,
        platform,
        type: 'initial',
        windowStart: admin.firestore.Timestamp.fromMillis(Date.now() - 90 * 24 * 3600 * 1000),
        windowEnd: admin.firestore.Timestamp.now(),
        createdBy: uid,
    }, { jobId: `init_${accId}` });
    await store.writeAudit(db, workspaceId, {
        actorUid: uid,
        action: AUDIT_ACTIONS.CONNECT,
        targetCollection: 'commerce_accounts',
        targetId: accId,
        after: { platform, shop_id: shop.shopId },
    });
}

async function handleDisconnect(db, event, headers) {
    const caller = await verifyCaller(event);
    if (!caller) return json(401, { error: 'unauthorized' }, headers);
    const body = safeJson(event.body);
    const { workspace_id: workspaceId, account_id: accId } = body;
    const member = await requireManagerRole(db, caller.uid, workspaceId);
    if (!member) return json(403, { error: 'requires owner or admin role' }, headers);

    const account = await store.getAccount(db, workspaceId, accId);
    if (!account) return json(404, { error: 'account not found' }, headers);

    // Best-effort remote revoke, then hard-delete the credentials.
    const connector = registry.get(account.platform);
    if (connector) {
        try {
            const credSnap = await tokenManager.credRef(db, workspaceId, account.platform, account.shop_id).get();
            if (credSnap.exists) await connector.revoke({ credentials: tokenManager.decryptCredentials(credSnap.data()) });
        } catch (e) {
            console.warn('[commerce] revoke best-effort failed', e.message);
        }
    }
    await tokenManager.deleteCredentials(db, { workspaceId, platform: account.platform, shopId: account.shop_id });
    await store.updateAccount(db, workspaceId, accId, {
        status: 'disconnected',
        sync_health: null,
        token_expires_at: null,
    });
    await store.setShopDirectory(db, {
        platform: account.platform,
        shopId: account.shop_id,
        workspaceId,
        accountId: accId,
        status: 'disconnected',
    });
    await store.writeAudit(db, workspaceId, {
        actorUid: caller.uid,
        action: AUDIT_ACTIONS.DISCONNECT,
        targetCollection: 'commerce_accounts',
        targetId: accId,
        after: { platform: account.platform },
    });
    return json(200, { disconnected: true }, headers);
}

async function handleSyncNow(db, event, headers) {
    const caller = await verifyCaller(event);
    if (!caller) return json(401, { error: 'unauthorized' }, headers);
    const body = safeJson(event.body);
    const { workspace_id: workspaceId, account_id: accId } = body;
    const member = await requireManagerRole(db, caller.uid, workspaceId);
    if (!member) return json(403, { error: 'requires owner or admin role' }, headers);

    const account = await store.getAccount(db, workspaceId, accId);
    if (!account || account.status === 'disconnected') return json(404, { error: 'account not connected' }, headers);
    if (await hasActiveJob(db, workspaceId, accId)) {
        return json(429, { error: 'a sync is already pending for this account' }, headers);
    }
    const { id } = await enqueueJob(db, workspaceId, {
        accountId: accId,
        platform: account.platform,
        type: 'manual',
        createdBy: caller.uid,
    });
    await store.writeAudit(db, workspaceId, {
        actorUid: caller.uid,
        action: AUDIT_ACTIONS.SYNC,
        targetCollection: 'commerce_sync_jobs',
        targetId: id,
        after: { account_id: accId, type: 'manual' },
    });
    return json(202, { queued: true, job_id: id }, headers);
}

// Ops/sandbox path: install CONSOLE-ISSUED tokens (TikTok's sandbox hands out
// access tokens directly, with no OAuth dance) as a connected account. Guarded
// by the INTERNAL_API_TOKEN shared secret (same server-to-server pattern as
// extend-trial / the background delegator) — never exposed to browsers.
// Body: { workspace_id, platform, shop: {shopId, shopName, region, currency},
//         tokens: {accessToken, refreshToken?, accessExpiresAt?, refreshExpiresAt?},
//         platform_meta? }
async function handleInstallCredentials(db, event, headers) {
    const provided = event.headers['x-internal-token'] || event.headers['X-Internal-Token'];
    if (!process.env.INTERNAL_API_TOKEN || provided !== process.env.INTERNAL_API_TOKEN) {
        return json(401, { error: 'unauthorized' }, headers);
    }
    const body = safeJson(event.body);
    const { workspace_id: workspaceId, platform, shop, tokens } = body;
    if (!workspaceId || !platform || !shop || !shop.shopId || !tokens || !tokens.accessToken) {
        return json(400, { error: 'workspace_id, platform, shop.shopId, tokens.accessToken required' }, headers);
    }
    if (!registry.get(platform)) return json(404, { error: `unknown platform '${platform}'` }, headers);
    await finishConnect(db, {
        workspaceId,
        platform,
        uid: 'internal-ops',
        result: { tokens, shop, platformMeta: body.platform_meta || {} },
    });
    return json(200, { installed: true, account_id: makeAccountId(platform, shop.shopId) }, headers);
}

function safeJson(body) {
    try { return JSON.parse(body || '{}'); } catch (_) { return {}; }
}
