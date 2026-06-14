'use strict';

// Processes "send weekly digest now" jobs queued from the internal console
// (internal_digest_jobs). Runs every 2 minutes. This is how an admin triggers a
// one-time broadcast WITH the AI narrative (the deployed env has OPENAI_API_KEY)
// without exposing a public email endpoint. Gated by DIGEST_ENABLED.
const { schedule } = require('@netlify/functions');
const admin = require('firebase-admin');
const { initAdmin } = require('./lib/notify-core');
const { runWeeklyDigestSweep } = require('./lib/digest-core');

exports.handler = schedule('*/2 * * * *', async () => {
    if (process.env.DIGEST_ENABLED !== 'true') {
        console.log('digest-broadcast-worker skipped: DIGEST_ENABLED !== "true"');
        return { statusCode: 200, body: 'disabled' };
    }
    const db = initAdmin();
    const FV = admin.firestore.FieldValue;
    const snap = await db.collection('internal_digest_jobs').where('status', '==', 'pending').limit(3).get();

    let processed = 0;
    for (const doc of snap.docs) {
        const ref = doc.ref;
        const job = doc.data() || {};
        // Claim the job (best-effort; concurrent runs just re-read 'processing').
        try { await ref.update({ status: 'processing', started_at: FV.serverTimestamp() }); } catch (_e) { continue; }
        try {
            const result = await runWeeklyDigestSweep(db, { now: new Date(), force: true, dryRun: job.mode === 'dryRun', logger: console });
            await ref.update({ status: 'done', finished_at: FV.serverTimestamp(), result, error: null });
            processed += 1;
        } catch (e) {
            await ref.update({ status: 'failed', finished_at: FV.serverTimestamp(), error: String(e.message).slice(0, 500) }).catch(() => {});
        }
    }
    return { statusCode: 200, body: JSON.stringify({ pending: snap.size, processed }) };
});
