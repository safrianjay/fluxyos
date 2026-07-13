'use strict';

// =============================================================================
// Commerce Integration Platform — nightly reconciliation (cron 02:00 WIB)
//
// Webhooks and incrementals cover latency; this covers CORRECTNESS: one
// reconcile job per connected account re-fetches the last 48h and re-upserts
// (deterministic ids ⇒ diffs converge, duplicates impossible), so a lost
// webhook or a missed incremental window degrades freshness, never data.
// The worker delegates these jobs to commerce-sync-background. Gated by
// COMMERCE_SYNC_ENABLED; registered in SCHEDULED_FUNCTIONS (pruned from the
// marketing deploy). See docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md (D5).
// =============================================================================

const { schedule } = require('@netlify/functions');
const admin = require('firebase-admin');
const { initAdmin } = require('./lib/notify-core');
const registry = require('./lib/commerce/registry');
const jobs = require('./lib/commerce/jobs');
const { ENV, flagEnabled } = require('./lib/commerce/constants');

// 19:00 UTC = 02:00 WIB.
exports.handler = schedule('0 19 * * *', async () => {
    if (!flagEnabled(ENV.COMMERCE_SYNC_ENABLED)) {
        console.log('commerce-reconcile skipped: COMMERCE_SYNC_ENABLED !== "true"');
        return { statusCode: 200, body: 'disabled' };
    }
    const db = initAdmin();
    const now = Date.now();
    const snap = await db.collectionGroup('commerce_accounts')
        .where('status', '==', 'connected')
        .limit(200)
        .get();

    let enqueued = 0;
    for (const doc of snap.docs) {
        const account = doc.data();
        const workspaceId = doc.ref.parent.parent.id;
        if (!registry.get(account.platform)) continue;
        const initial = account.initial_sync || {};
        if (initial.status && initial.status !== 'done') continue;
        // One per account per night, idempotent across cron retries.
        const res = await jobs.enqueueJob(db, workspaceId, {
            accountId: doc.id,
            platform: account.platform,
            type: 'reconcile',
            windowStart: admin.firestore.Timestamp.fromMillis(now - 48 * 3600 * 1000),
            windowEnd: admin.firestore.Timestamp.fromMillis(now),
            createdBy: 'system',
        }, { jobId: `rec_${doc.id}_${new Date(now).toISOString().slice(0, 10)}` });
        if (res.created) enqueued += 1;
    }
    console.log('commerce-reconcile enqueued', enqueued);
    return { statusCode: 200, body: JSON.stringify({ enqueued }) };
});
