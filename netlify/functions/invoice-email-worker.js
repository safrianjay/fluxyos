'use strict';

// =============================================================================
// Invoice auto-email — retry sweep (cron */5)
//
// The enqueue function kicks the background render+send immediately, so this
// worker is the SAFETY NET: it drains any invoice_email_jobs that are due for a
// (backoff) retry or whose instant delegation never landed, claims each
// (transactional pending→processing), and re-delegates it to the background
// function. Structure mirrors commerce-sync-worker.js. Gated by default-off
// INVOICE_EMAIL_ENABLED and registered in scripts/prepare-deploy.js
// SCHEDULED_FUNCTIONS (pruned from the marketing deploy so it can never
// double-run).
// =============================================================================

const { schedule } = require('@netlify/functions');
const { initAdmin } = require('./lib/notify-core');
const jobs = require('./lib/invoice-email/jobs');
const { delegateToBackground } = require('./lib/invoice-email/delegate');

exports.handler = schedule('*/5 * * * *', async () => {
    if (process.env.INVOICE_EMAIL_ENABLED !== 'true') {
        console.log('invoice-email-worker skipped: INVOICE_EMAIL_ENABLED !== "true"');
        return { statusCode: 200, body: 'disabled' };
    }
    const db = initAdmin();
    const summary = { due: 0, delegated: 0, failed: 0 };

    try {
        const due = await jobs.listDueJobs(db, { limit: 10 });
        summary.due = due.length;
        for (const doc of due) {
            const jobRef = doc.ref;
            const workspaceId = jobRef.parent.parent.id;
            const job = await jobs.claimJob(db, jobRef);
            if (!job) continue; // someone else won the race / not due
            const ok = await delegateToBackground(workspaceId, jobRef.id);
            if (ok) {
                summary.delegated += 1;
            } else {
                // Couldn't reach the background fn — release for the next sweep.
                await jobs.failJob(jobRef, job, new Error('background delegation failed'));
                summary.failed += 1;
            }
        }
    } catch (e) {
        console.error('[invoice-email-worker] sweep failed', e.message);
    }

    console.log('invoice-email-worker', JSON.stringify(summary));
    return { statusCode: 200, body: JSON.stringify(summary) };
});
