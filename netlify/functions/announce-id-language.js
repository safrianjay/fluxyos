'use strict';

// ONE-TIME product-update broadcast: "FluxyOS now speaks Bahasa Indonesia".
//
// Default OFF. Sends the bilingual `announce_id_language` template to every
// `internal_users` row EXACTLY ONCE. Exactly-once is guaranteed by a fixed
// idempotency key (`users/{uid}/mail_log/announce_id_language_v1`), so a re-run
// — or two overlapping runs — never double-sends, and there is no backfill
// vector: a user is emailed once, ever, regardless of when they signed up.
//
// Runbook (Netlify env):
//   1. Set ANNOUNCE_ID_LANG_ENABLED=true to arm it. This is a SEPARATE kill
//      switch from NOTIFY_ENABLED / DIGEST_ENABLED on purpose — arming the
//      announcement does NOT un-pause the transactional sweeps.
//   2. The scheduled run walks the whole roster and sends. Watch the function
//      log: `{ scanned, sent, skipped, failed }`. When a run reports `sent: 0`
//      (everyone already has the key), the broadcast is complete.
//   3. Set ANNOUNCE_ID_LANG_ENABLED back to false (or unset) to disarm.
//
// Requires the same env as the other sweeps: FIREBASE_SERVICE_ACCOUNT,
// RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO, APP_BASE_URL. Schedule-only (no
// public HTTP), consistent with the no-relay-endpoint posture in NOTIFICATIONS.md.

const { schedule } = require('@netlify/functions');
const admin = require('firebase-admin');
const { initAdmin } = require('./lib/notify-core');
const { sendNotificationEmail } = require('../../functions/lib/email');

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://fluxyos.com';

// Bump the version suffix ONLY to deliberately re-announce to everyone again.
const EVENT_KEY = 'announce_id_language_v1';
const TEMPLATE_KEY = 'announce_id_language';

const BATCH = 300;        // Firestore page size
const MAX_USERS = 20000;  // safety ceiling so a runaway roster can't loop forever

// Walk internal_users and send the announcement once per user. `send` is
// injectable so the logic can be unit-tested without Resend/Firestore.
async function broadcast(db, { logger = console, send = sendNotificationEmail } = {}) {
    let scanned = 0, sent = 0, skipped = 0, failed = 0;
    let lastDoc = null;

    while (scanned < MAX_USERS) {
        let q = db.collection('internal_users').orderBy(admin.firestore.FieldPath.documentId()).limit(BATCH);
        if (lastDoc) q = q.startAfter(lastDoc);
        const snap = await q.get();
        if (snap.empty) break;

        for (const doc of snap.docs) {
            lastDoc = doc;
            scanned += 1;
            const u = doc.data() || {};
            const to = u.email;
            if (!to) { skipped += 1; continue; }
            try {
                const r = await send({
                    db,
                    uid: doc.id,
                    to,
                    eventKey: EVENT_KEY,
                    templateKey: TEMPLATE_KEY,
                    locale: 'en', // content is bilingual; locale only labels the mail_log row
                    data: { baseUrl: APP_BASE_URL },
                    logger,
                });
                if (r && r.sent) sent += 1;
                else skipped += 1; // duplicate (already sent) or no_recipient
            } catch (e) {
                failed += 1;
                (logger.error || console.error)('announce-id-language: user failed', { uid: doc.id, error: e.message });
            }
        }

        if (snap.size < BATCH) break; // last page
    }

    (logger.info || console.log)('announce-id-language complete', { scanned, sent, skipped, failed });
    return { scanned, sent, skipped, failed };
}

exports.handler = schedule('*/5 * * * *', async () => {
    if (process.env.ANNOUNCE_ID_LANG_ENABLED !== 'true') {
        console.log('announce-id-language skipped: ANNOUNCE_ID_LANG_ENABLED !== "true"');
        return { statusCode: 200, body: 'disabled' };
    }
    const db = initAdmin();
    const result = await broadcast(db, { logger: console });
    return { statusCode: 200, body: JSON.stringify(result) };
});

// Exported for the local smoke test (sends nothing).
module.exports.broadcast = broadcast;
module.exports.EVENT_KEY = EVENT_KEY;
module.exports.TEMPLATE_KEY = TEMPLATE_KEY;
