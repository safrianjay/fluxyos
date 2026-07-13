'use strict';

// =============================================================================
// Commerce Integration Platform — heavy sync runner (background function)
//
// Netlify background function (name ends `-background`, ~15-min budget) for
// the 90-day initial import and the nightly reconcile, delegated by the
// sync worker via the INTERNAL_API_TOKEN shared-secret header. Long windows
// run in 15-day chunks (Shopee's order-list cap) and the finished window edge
// is persisted onto the job after EVERY chunk, so a timeout resumes instead
// of restarting. Progress is mirrored to commerce_accounts.initial_sync for
// the drawer's progress bar. See docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md (D5).
// =============================================================================

const admin = require('firebase-admin');
const { initAdmin } = require('./lib/notify-core');
const pipeline = require('./lib/commerce/pipeline');
const jobs = require('./lib/commerce/jobs');
const store = require('./lib/commerce/store');
const { ENV, flagEnabled } = require('./lib/commerce/constants');

const CHUNK_MS = 15 * 24 * 3600 * 1000;

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'method not allowed' };
    if (!flagEnabled(ENV.COMMERCE_SYNC_ENABLED)) return { statusCode: 503, body: 'disabled' };
    const provided = event.headers['x-internal-token'] || event.headers['X-Internal-Token'];
    if (!process.env.INTERNAL_API_TOKEN || provided !== process.env.INTERNAL_API_TOKEN) {
        return { statusCode: 401, body: 'unauthorized' };
    }

    let payload;
    try { payload = JSON.parse(event.body || '{}'); } catch (_) { payload = {}; }
    const { workspace_id: workspaceId, job_id: jobId } = payload;
    if (!workspaceId || !jobId) return { statusCode: 400, body: 'workspace_id and job_id required' };

    const db = initAdmin();
    const jobRef = jobs.jobsCol(db, workspaceId).doc(jobId);
    const snap = await jobRef.get();
    if (!snap.exists) return { statusCode: 404, body: 'job not found' };
    const job = snap.data();
    // The worker claims pending→processing before delegating; accept a
    // still-pending job too (direct internal trigger), claiming it here.
    if (job.status === 'pending') {
        const claimed = await jobs.claimJob(db, jobRef);
        if (!claimed) return { statusCode: 409, body: 'job already claimed' };
        job.attempts = claimed.attempts;
    } else if (job.status !== 'processing') {
        return { statusCode: 409, body: `job is ${job.status}` };
    }

    try {
        const account = await store.getAccount(db, workspaceId, job.account_id);
        if (!account || account.status === 'disconnected') throw new Error('account not connected');

        const windowEnd = job.window_end ? job.window_end.toDate() : new Date();
        const windowStart = job.window_start
            ? job.window_start.toDate()
            : new Date(windowEnd.getTime() - (job.type === 'reconcile' ? 48 * 3600 * 1000 : 90 * 24 * 3600 * 1000));
        // Resume point: cursor.window_done (ms of the last finished chunk edge).
        let cursorMs = job.cursor && job.cursor.window_done ? Number(job.cursor.window_done) : windowStart.getTime();
        const totalMs = Math.max(1, windowEnd.getTime() - windowStart.getTime());
        const totals = { orders: 0, refunds: 0, settlements: 0, ledger_writes: 0, rejects: 0 };

        while (cursorMs < windowEnd.getTime()) {
            const chunkEnd = Math.min(cursorMs + CHUNK_MS, windowEnd.getTime());
            const stats = await pipeline.syncWindow(db, {
                workspaceId,
                account,
                since: new Date(cursorMs),
                until: new Date(chunkEnd),
                jobId,
            });
            Object.keys(totals).forEach((k) => { totals[k] += stats[k] || 0; });
            cursorMs = chunkEnd;

            // Persist the resume point + surface progress after every chunk.
            await jobRef.update({ cursor: { window_done: cursorMs }, stats: totals });
            if (job.type === 'initial') {
                const pct = Math.min(100, Math.round(((cursorMs - windowStart.getTime()) / totalMs) * 100));
                await store.updateAccount(db, workspaceId, job.account_id, {
                    initial_sync: { status: 'running', progress_pct: pct },
                });
            }
        }

        await jobs.completeJob(jobRef, totals);
        const patch = {
            last_sync_at: new Date(),
            last_sync_status: 'ok',
            sync_health: 'healthy',
            status: 'connected',
        };
        if (job.type === 'initial') patch.initial_sync = { status: 'done', progress_pct: 100 };
        await store.updateAccount(db, workspaceId, job.account_id, patch);
        console.log('[commerce-background] done', jobId, JSON.stringify(totals));
        return { statusCode: 200, body: JSON.stringify(totals) };
    } catch (e) {
        const authError = e.code === 'auth';
        const { dead } = await jobs.failJob(jobRef, job, e, { authError });
        await pipeline.noteJobFailure(db, { workspaceId, job, jobId, error: e, dead });
        console.error('[commerce-background] failed', jobId, e.message);
        return { statusCode: 500, body: 'sync failed' };
    }
};
