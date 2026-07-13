'use strict';

// =============================================================================
// Commerce Integration Platform — public webhook receiver
//
// /api/v1/commerce/webhooks/{platform} (mapped in netlify.toml ABOVE both the
// commerce API rule and the /api/v1/* catch-all). Thin receiver, fat worker:
// verify the platform HMAC against the EXACT raw bytes, resolve the shop to a
// workspace via the deny-all directory, log the delivery (deterministic id =
// redelivery dedupe), coalesce a webhook sync job, return 200 fast. No
// marketplace fetches here — the worker does the work; the nightly reconcile
// backstops lost deliveries. See docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md (D4).
// =============================================================================

const { initAdmin } = require('./lib/notify-core');
const registry = require('./lib/commerce/registry');
const store = require('./lib/commerce/store');
const { enqueueWebhookJob } = require('./lib/commerce/jobs');
const { ENV, flagEnabled } = require('./lib/commerce/constants');

function respond(statusCode, body) {
    return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return respond(405, { error: 'method not allowed' });
    if (!flagEnabled(ENV.COMMERCE_WEBHOOKS_ENABLED)) return respond(503, { error: 'disabled' });

    const match = event.path.match(/\/webhooks\/([a-z_]+)$/);
    const platform = match && match[1];
    const connector = platform && registry.get(platform);
    if (!connector) return respond(404, { error: 'unknown platform' });

    // Exact raw bytes for HMAC — NEVER JSON.parse before verification, and
    // honor Netlify's base64 encoding. Shopee signs url|body: reconstruct the
    // canonical public URL from env + path (proxy headers are not trustworthy).
    const rawBody = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8');
    const base = (process.env[ENV.COMMERCE_REDIRECT_BASE_URL] || 'https://dashboard.fluxyos.com').replace(/\/$/, '');
    const url = `${base}/api/v1/commerce/webhooks/${platform}`;

    const verdict = connector.verifyWebhook({ headers: event.headers || {}, rawBody, url });
    if (!verdict.ok) {
        console.warn('[commerce-webhook] bad signature', platform);
        return respond(401, { error: 'invalid signature' });
    }

    let parsed;
    try {
        parsed = connector.parseWebhookEvent(rawBody);
    } catch (e) {
        console.warn('[commerce-webhook] unparseable payload', platform, e.message);
        return respond(200, { ok: true }); // signed but odd — ack, reconcile catches data
    }

    const db = initAdmin();
    const directory = await store.lookupShopDirectory(db, platform, parsed.shopId);
    if (!directory) {
        // Unknown/disconnected shop: ack without revealing which shops exist.
        console.warn('[commerce-webhook] unknown shop', platform, parsed.shopId);
        return respond(200, { ok: true });
    }
    const workspaceId = directory.workspace_id;

    const log = await store.logWebhook(db, workspaceId, {
        platform,
        shopId: parsed.shopId,
        eventType: parsed.eventType,
        eventId: parsed.eventId,
        rawBody,
        signatureValid: true,
    });
    if (log.duplicate) return respond(200, { ok: true, duplicate: true });

    const job = await enqueueWebhookJob(db, workspaceId, {
        accountId: directory.account_id,
        platform,
        orderIds: parsed.orderIds || [],
    });
    return respond(200, { ok: true, job_id: job.id });
};
