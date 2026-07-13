'use strict';

// =============================================================================
// Commerce Integration Platform — sync job queue
//
// commerce_sync_jobs live under workspaces/{wsId}/ (client-readable for the
// drawer history, server-written only). Status transitions mirror the proven
// digest-broadcast-worker pattern, hardened with transaction claims and
// exponential backoff. Deterministic job ids make enqueues idempotent
// (create() fail-if-exists). See docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md (D5).
// =============================================================================

const admin = require('firebase-admin');
const { JOB_MAX_ATTEMPTS, JOB_BACKOFF_BASE_MS } = require('./constants');

function jobsCol(db, workspaceId) {
    return db.collection(`workspaces/${workspaceId}/commerce_sync_jobs`);
}

// next_attempt_at delay for attempt N (1-based): base · 2^(N−1) ± 20% jitter.
function backoffMs(attempt, { base = JOB_BACKOFF_BASE_MS, rand = Math.random } = {}) {
    const exp = base * Math.pow(2, Math.max(0, attempt - 1));
    const jitter = exp * 0.2 * (rand() * 2 - 1);
    return Math.round(exp + jitter);
}

// Enqueue a job. With `jobId` set, create() makes the enqueue idempotent —
// an AlreadyExists error is swallowed and reported as { created: false }.
async function enqueueJob(db, workspaceId, job, { jobId = null } = {}) {
    const FV = admin.firestore.FieldValue;
    const data = {
        account_id: job.accountId,
        platform: job.platform,
        type: job.type,
        status: 'pending',
        window_start: job.windowStart || null,
        window_end: job.windowEnd || null,
        cursor: job.cursor || null,
        order_ids: job.orderIds || null,
        attempts: 0,
        max_attempts: JOB_MAX_ATTEMPTS,
        next_attempt_at: admin.firestore.Timestamp.now(),
        last_error: null,
        stats: null,
        created_by: job.createdBy || 'system',
        created_at: FV.serverTimestamp(),
        started_at: null,
        finished_at: null,
    };
    const ref = jobId ? jobsCol(db, workspaceId).doc(jobId) : jobsCol(db, workspaceId).doc();
    try {
        await ref.create(data);
        return { created: true, id: ref.id };
    } catch (e) {
        if (e.code === 6 /* ALREADY_EXISTS */) return { created: false, id: ref.id };
        throw e;
    }
}

// Coalesce a webhook event into an existing pending webhook job for the same
// account (merging order_ids) instead of piling up one job per delivery.
async function enqueueWebhookJob(db, workspaceId, { accountId, platform, orderIds = [] }) {
    const FV = admin.firestore.FieldValue;
    const pending = await jobsCol(db, workspaceId)
        .where('account_id', '==', accountId)
        .where('type', '==', 'webhook')
        .where('status', '==', 'pending')
        .limit(1)
        .get();
    if (!pending.empty) {
        const ref = pending.docs[0].ref;
        if (orderIds.length) {
            await ref.update({ order_ids: FV.arrayUnion(...orderIds) }).catch(() => {});
        }
        return { created: false, id: ref.id };
    }
    return enqueueJob(db, workspaceId, { accountId, platform, type: 'webhook', orderIds, createdBy: 'system' });
}

// Claim one job pending→processing inside a transaction. Returns the claimed
// snapshot data or null when someone else won the race.
async function claimJob(db, jobRef, { now = admin.firestore.Timestamp.now() } = {}) {
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(jobRef);
        if (!snap.exists) return null;
        const job = snap.data();
        if (job.status !== 'pending') return null;
        if (job.next_attempt_at && job.next_attempt_at.toMillis() > now.toMillis()) return null;
        tx.update(jobRef, {
            status: 'processing',
            attempts: (job.attempts || 0) + 1,
            started_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { ...job, attempts: (job.attempts || 0) + 1 };
    });
}

async function completeJob(jobRef, stats) {
    await jobRef.update({
        status: 'done',
        finished_at: admin.firestore.FieldValue.serverTimestamp(),
        stats: stats || null,
        last_error: null,
    });
}

// Failure path: retry with backoff until max_attempts, then 'dead'. `authError`
// short-circuits straight to dead (the account is expired — retrying can't fix
// an invalid refresh token).
async function failJob(jobRef, job, error, { authError = false } = {}) {
    const attempts = job.attempts || 1;
    const isDead = authError || attempts >= (job.max_attempts || JOB_MAX_ATTEMPTS);
    const update = {
        status: isDead ? 'dead' : 'pending',
        last_error: String(error && error.message ? error.message : error).slice(0, 500),
        finished_at: isDead ? admin.firestore.FieldValue.serverTimestamp() : null,
    };
    if (!isDead) {
        update.next_attempt_at = admin.firestore.Timestamp.fromMillis(Date.now() + backoffMs(attempts));
    }
    await jobRef.update(update);
    return { dead: isDead };
}

// Worker drain query: due pending jobs across ALL workspaces (collection
// group; composite index status ASC + next_attempt_at ASC).
async function listDueJobs(db, { limit = 5, now = admin.firestore.Timestamp.now() } = {}) {
    const snap = await db.collectionGroup('commerce_sync_jobs')
        .where('status', '==', 'pending')
        .where('next_attempt_at', '<=', now)
        .orderBy('next_attempt_at', 'asc')
        .limit(limit)
        .get();
    return snap.docs;
}

// Is there already a pending/processing job for this account? (sync-now throttle)
async function hasActiveJob(db, workspaceId, accountId) {
    const snap = await jobsCol(db, workspaceId)
        .where('account_id', '==', accountId)
        .where('status', 'in', ['pending', 'processing'])
        .limit(1)
        .get();
    return !snap.empty;
}

module.exports = {
    jobsCol,
    backoffMs,
    enqueueJob,
    enqueueWebhookJob,
    claimJob,
    completeJob,
    failJob,
    listDueJobs,
    hasActiveJob,
};
