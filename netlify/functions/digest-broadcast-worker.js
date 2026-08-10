'use strict';

// Processes "send weekly digest now" jobs queued from the internal console
// (internal_digest_jobs). Runs every 2 minutes. This is how an admin triggers a
// one-time broadcast WITH the AI narrative (the deployed env has OPENAI_API_KEY)
// without exposing a public email endpoint. Gated by DIGEST_ENABLED.
const { schedule } = require('@netlify/functions');
const admin = require('firebase-admin');
const { initAdmin } = require('./lib/notify-core');
const { runWeeklyDigestSweep, generateWeeklyDigest, getEffectivePrefs, isPaymentVerified } = require('./lib/digest-core');

// One named user, rather than the whole roster. The worker was all-or-nothing,
// so "send this person their digest" — verifying a fix, re-sending after a
// support question — meant emailing every eligible customer to reach one of them.
// The payment gate still applies: a targeted send is a convenience, not a way
// around the rule that the digest goes to accounts a reviewer verified.
async function sendToOneUser(db, uid, { dryRun = false } = {}) {
    const snap = await db.collection('internal_users').doc(uid).get();
    if (!snap.exists) return { skipped: 'not_on_roster', uid };
    const rosterUser = snap.data() || {};
    if (!isPaymentVerified(rosterUser)) return { skipped: 'unverified_payment', uid };
    const prefs = await getEffectivePrefs(db, uid, rosterUser);
    if (!prefs.weekly_digest_enabled) return { skipped: 'digest_disabled', uid };
    const r = await generateWeeklyDigest(db, uid, prefs, { now: new Date(), logger: console, dryRun });
    // Drop the rendered email rather than setting it to undefined: the result is
    // written straight to the job doc, and Firestore rejects an undefined value —
    // which fails the whole job AFTER the send has already happened.
    const { prebuilt, ...rest } = r;
    void prebuilt;
    return { uid, ...rest };
}

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
            const dryRun = job.mode === 'dryRun';
            // A job naming a uid targets that one account; without it the job is
            // the original roster-wide broadcast.
            const result = job.uid
                ? await sendToOneUser(db, String(job.uid), { dryRun })
                : await runWeeklyDigestSweep(db, { now: new Date(), force: true, dryRun, logger: console });
            await ref.update({ status: 'done', finished_at: FV.serverTimestamp(), result, error: null });
            processed += 1;
        } catch (e) {
            await ref.update({ status: 'failed', finished_at: FV.serverTimestamp(), error: String(e.message).slice(0, 500) }).catch(() => {});
        }
    }
    return { statusCode: 200, body: JSON.stringify({ pending: snap.size, processed }) };
});
