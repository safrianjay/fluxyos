'use strict';

// =============================================================================
// Commerce Integration Platform — sync worker (cron */5)
//
// Three passes per run, all gated by COMMERCE_SYNC_ENABLED (default off):
//   (a) schedule — enqueue an incremental job for each connected account whose
//       last sync is >10 min old; deterministic job id inc_{acc}_{10-min slot}
//       via create() ⇒ structurally cannot double-enqueue.
//   (b) refresh  — proactively refresh credentials expiring within 30 min
//       (Shopee's 4-hour tokens make this pass load-bearing).
//   (c) drain    — claim up to 5 due jobs (collection-group, transaction
//       claim); run small jobs inline; delegate heavy ones (initial/reconcile)
//       to commerce-sync-background via INTERNAL_API_TOKEN.
//
// Registered in scripts/prepare-deploy.js SCHEDULED_FUNCTIONS (pruned from the
// marketing deploy). See docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md (D5).
// =============================================================================

const { schedule } = require('@netlify/functions');
const admin = require('firebase-admin');
const { initAdmin } = require('./lib/notify-core');
const registry = require('./lib/commerce/registry');
const tokenManager = require('./lib/commerce/token-manager');
const jobs = require('./lib/commerce/jobs');
const pipeline = require('./lib/commerce/pipeline');
const store = require('./lib/commerce/store');
const { ENV, flagEnabled } = require('./lib/commerce/constants');

const INCREMENTAL_EVERY_MS = 10 * 60 * 1000;
const HEAVY_TYPES = new Set(['initial', 'reconcile']);

exports.handler = schedule('*/5 * * * *', async () => {
    if (!flagEnabled(ENV.COMMERCE_SYNC_ENABLED)) {
        console.log('commerce-sync-worker skipped: COMMERCE_SYNC_ENABLED !== "true"');
        return { statusCode: 200, body: 'disabled' };
    }
    const db = initAdmin();
    const summary = { scheduled: 0, refreshed: 0, drained: 0, delegated: 0, failed: 0 };

    await schedulePass(db, summary).catch((e) => console.error('[worker] schedule pass', e.message));
    await refreshPass(db, summary).catch((e) => console.error('[worker] refresh pass', e.message));
    await drainPass(db, summary).catch((e) => console.error('[worker] drain pass', e.message));

    console.log('commerce-sync-worker', JSON.stringify(summary));
    return { statusCode: 200, body: JSON.stringify(summary) };
});

// (a) enqueue incrementals for stale connected accounts.
async function schedulePass(db, summary) {
    const now = Date.now();
    const snap = await db.collectionGroup('commerce_accounts')
        .where('status', '==', 'connected')
        .limit(100)
        .get();
    for (const doc of snap.docs) {
        const account = doc.data();
        // Path: workspaces/{ws}/commerce_accounts/{id}
        const workspaceId = doc.ref.parent.parent.id;
        if (!registry.get(account.platform)) continue;
        const initial = account.initial_sync || {};
        if (initial.status && initial.status !== 'done') continue; // let the import finish first
        const last = account.last_sync_at && account.last_sync_at.toMillis ? account.last_sync_at.toMillis() : 0;
        if (now - last < INCREMENTAL_EVERY_MS) continue;
        const slot = Math.floor(now / INCREMENTAL_EVERY_MS);
        const res = await jobs.enqueueJob(db, workspaceId, {
            accountId: doc.id,
            platform: account.platform,
            type: 'incremental',
            createdBy: 'system',
        }, { jobId: `inc_${doc.id}_${slot}` });
        if (res.created) summary.scheduled += 1;
    }
}

// (b) refresh credentials expiring soon.
async function refreshPass(db, summary) {
    const expiring = await tokenManager.listExpiringCredentials(db, { withinMs: 30 * 60 * 1000, limit: 10 });
    for (const cred of expiring) {
        const connector = registry.get(cred.platform);
        if (!connector || !registry.isConfigured(cred.platform)) continue;
        try {
            await tokenManager.getValidCredentials(db, {
                workspaceId: cred.workspace_id,
                platform: cred.platform,
                shopId: cred.shop_id,
                connector,
                // Force the refresh branch regardless of the 10-min window.
                now: (cred.access_expires_at ? cred.access_expires_at.toMillis() : Date.now()),
            });
            summary.refreshed += 1;
        } catch (e) {
            if (e.code === 'auth') {
                await store.updateAccount(db, cred.workspace_id, cred.account_id, { status: 'expired', sync_health: 'failing' }).catch(() => {});
            }
            console.warn('[worker] refresh failed', cred.account_id, e.message);
        }
    }
}

// (c) drain due jobs.
async function drainPass(db, summary) {
    const due = await jobs.listDueJobs(db, { limit: 5 });
    for (const doc of due) {
        const jobRef = doc.ref;
        const workspaceId = jobRef.parent.parent.id;
        const job = await jobs.claimJob(db, jobRef);
        if (!job) continue;

        if (HEAVY_TYPES.has(job.type)) {
            const ok = await delegateToBackground(workspaceId, jobRef.id);
            if (ok) {
                summary.delegated += 1;
            } else {
                // Couldn't reach the background fn — back to pending for retry.
                await jobs.failJob(jobRef, job, new Error('background delegation failed'));
                summary.failed += 1;
            }
            continue;
        }

        try {
            const stats = await pipeline.runSmallJob(db, { workspaceId, jobRef, job });
            await jobs.completeJob(jobRef, stats);
            summary.drained += 1;
        } catch (e) {
            const authError = e.code === 'auth';
            const { dead } = await jobs.failJob(jobRef, job, e, { authError });
            await pipeline.noteJobFailure(db, { workspaceId, job, jobId: jobRef.id, error: e, dead });
            summary.failed += 1;
        }
    }
}

// Heavy jobs run in the 15-min background function; shared-secret header per
// the existing INTERNAL_API_TOKEN pattern (extend-trial, send-lead-outreach).
async function delegateToBackground(workspaceId, jobId) {
    const base = (process.env[ENV.COMMERCE_REDIRECT_BASE_URL] || process.env.URL || '').replace(/\/$/, '');
    const token = process.env.INTERNAL_API_TOKEN;
    if (!base || !token) {
        console.error('[worker] cannot delegate: COMMERCE_REDIRECT_BASE_URL/URL or INTERNAL_API_TOKEN missing');
        return false;
    }
    try {
        const res = await fetch(`${base}/.netlify/functions/commerce-sync-background`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
            body: JSON.stringify({ workspace_id: workspaceId, job_id: jobId }),
        });
        return res.status === 202 || res.ok;
    } catch (e) {
        console.error('[worker] delegation fetch failed', e.message);
        return false;
    }
}
