'use strict';

// =============================================================================
// Invoice auto-email — delivery job queue
//
// invoice_email_jobs live under workspaces/{wsId}/ (client-readable for the
// invoice detail delivery badge + attempts timeline, server-written only).
// Mirrors the proven commerce_sync_jobs engine (netlify/functions/lib/commerce/
// jobs.js): deterministic job ids make enqueue idempotent (create() fail-if-
// exists), a transactional claim guards the pending→processing race, and
// failJob applies exponential backoff until max_attempts, then dead-letters.
//
// One doc = one email intent (an auto send on finalize, or a manual resend).
// Each delivery attempt is appended to the `attempts` subcollection for audit.
// See docs/PROJECT_BACKGROUND.md §4n and netlify/functions/NOTIFICATIONS.md.
// =============================================================================

const admin = require('firebase-admin');
const { JOB_MAX_ATTEMPTS, JOB_BACKOFF_BASE_MS } = require('../commerce/constants');

function jobsCol(db, workspaceId) {
    return db.collection(`workspaces/${workspaceId}/invoice_email_jobs`);
}

// next_attempt_at delay for attempt N (1-based): base · 2^(N−1) ± 20% jitter.
function backoffMs(attempt, { base = JOB_BACKOFF_BASE_MS, rand = Math.random } = {}) {
    const exp = base * Math.pow(2, Math.max(0, attempt - 1));
    const jitter = exp * 0.2 * (rand() * 2 - 1);
    return Math.round(exp + jitter);
}

// Enqueue a delivery job. With `jobId` set, create() makes the enqueue
// idempotent — a rapid double-submit (two "Finalize and send" clicks) throws
// ALREADY_EXISTS which we swallow and report as { created: false }.
async function enqueueJob(db, workspaceId, job, { jobId = null } = {}) {
    const FV = admin.firestore.FieldValue;
    const data = {
        invoice_id: job.invoiceId,
        type: job.type || 'auto', // 'auto' | 'manual'
        to: job.to,
        status: 'pending',
        attempts: 0,
        max_attempts: JOB_MAX_ATTEMPTS,
        next_attempt_at: admin.firestore.Timestamp.now(),
        last_error: null,
        provider_message_id: null,
        template_snapshot: job.templateSnapshot || null,
        notified_user_of_failure: false,
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

// Claim one job pending→processing inside a transaction. Returns the claimed
// snapshot data (with the incremented attempt count) or null when someone else
// won the race or it isn't due yet.
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

async function completeJob(jobRef, { providerMessageId = null } = {}) {
    await jobRef.update({
        status: 'done',
        finished_at: admin.firestore.FieldValue.serverTimestamp(),
        provider_message_id: providerMessageId,
        last_error: null,
    });
}

// Failure path: retry with backoff until max_attempts, then 'dead'.
// `permanentError` short-circuits straight to dead (e.g. a malformed recipient
// address — retrying can't fix it), mirroring the commerce `authError` branch.
async function failJob(jobRef, job, error, { permanentError = false } = {}) {
    const attempts = job.attempts || 1;
    const isDead = permanentError || attempts >= (job.max_attempts || JOB_MAX_ATTEMPTS);
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

// Append one delivery-attempt record (the auditable per-attempt log).
async function recordAttempt(jobRef, { attemptNumber, to, status, providerMessageId = null, error = null }) {
    await jobRef.collection('attempts').add({
        attempt_number: attemptNumber || null,
        to: to || null,
        status, // 'sent' | 'failed'
        provider_message_id: providerMessageId,
        error: error ? String(error).slice(0, 500) : null,
        at: admin.firestore.FieldValue.serverTimestamp(),
    });
}

// Worker drain query: due pending jobs across ALL workspaces (collection
// group; composite index status ASC + next_attempt_at ASC).
async function listDueJobs(db, { limit = 10, now = admin.firestore.Timestamp.now() } = {}) {
    const snap = await db.collectionGroup('invoice_email_jobs')
        .where('status', '==', 'pending')
        .where('next_attempt_at', '<=', now)
        .orderBy('next_attempt_at', 'asc')
        .limit(limit)
        .get();
    return snap.docs;
}

module.exports = {
    jobsCol,
    backoffMs,
    enqueueJob,
    claimJob,
    completeJob,
    failJob,
    recordAttempt,
    listDueJobs,
};
