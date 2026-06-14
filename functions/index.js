'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');

const { resolveUserLocale } = require('./lib/locale');
const { sendNotificationEmail } = require('./lib/email');
const { formatDate, firstName } = require('./lib/format');

admin.initializeApp();

// Resend API key — a Secret Manager secret bound per function (never committed).
// Set once with: firebase functions:secrets:set RESEND_API_KEY
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

// Non-secret config (functions/.env, with safe production defaults here).
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://fluxyos.com';

// Resolve a deliverable email for a uid: Firebase Auth first, then the
// denormalized internal index. Returns null when neither has one.
async function resolveUserEmail(db, uid) {
    try {
        const u = await admin.auth().getUser(uid);
        if (u && u.email) return u.email;
    } catch (_e) {
        // fall through to the index
    }
    try {
        const snap = await db.doc(`internal_users/${uid}`).get();
        if (snap.exists && snap.data().email) return snap.data().email;
    } catch (_e) {
        // ignore
    }
    return null;
}

// --------------------------------------------------------------------------
// Keep the internal operations index aligned with Firebase Authentication.
// User-owned Firestore data is intentionally left untouched: this trigger only
// removes the denormalized row rendered by /internal.
// --------------------------------------------------------------------------
exports.cleanupInternalUserOnAuthDelete = functions.auth.user().onDelete(async (user) => {
    await admin.firestore().doc(`internal_users/${user.uid}`).delete();
    functions.logger.info('Removed deleted Auth user from the internal index', {
        uid: user.uid,
    });
});

// --------------------------------------------------------------------------
// Welcome email on account creation.
// --------------------------------------------------------------------------
exports.sendWelcomeEmail = functions
    .runWith({ secrets: ['RESEND_API_KEY'] })
    .auth.user()
    .onCreate(async (user) => {
        if (!user.email) return;
        const db = admin.firestore();
        const locale = await resolveUserLocale(db, user.uid);
        await sendNotificationEmail({
            db,
            uid: user.uid,
            to: user.email,
            eventKey: 'welcome',
            templateKey: 'welcome',
            locale,
            data: { name: firstName(user.displayName), baseUrl: APP_BASE_URL },
            logger: functions.logger,
        }).catch((e) => functions.logger.error('Welcome email failed', { uid: user.uid, error: e.message }));
    });

// --------------------------------------------------------------------------
// KYC + payment status emails, driven off the internal operations index.
// The internal console (no Firebase identity) writes status here; this
// server-side trigger turns those transitions into customer emails.
// --------------------------------------------------------------------------
const KYC_TEMPLATES = {
    approved: 'kyc_approved',
    needs_revision: 'kyc_needs_revision',
    rejected: 'kyc_rejected',
};
const PAYMENT_TEMPLATES = {
    verified: 'payment_verified',
    rejected: 'payment_rejected',
};

exports.notifyOnInternalUserUpdate = onDocumentUpdated(
    { document: 'internal_users/{uid}', secrets: [RESEND_API_KEY] },
    async (event) => {
        const uid = event.params.uid;
        const before = (event.data && event.data.before && event.data.before.data()) || {};
        const after = (event.data && event.data.after && event.data.after.data()) || {};
        const db = admin.firestore();

        const to = after.email || before.email || (await resolveUserEmail(db, uid));
        if (!to) {
            logger.warn('No recipient for internal_users update', { uid });
            return;
        }

        const locale = await resolveUserLocale(db, uid);
        const name = firstName(after.display_name || before.display_name);
        const note = after.last_internal_note || null;

        // KYC transition
        if (after.kyc_status && after.kyc_status !== before.kyc_status) {
            const templateKey = KYC_TEMPLATES[after.kyc_status];
            if (templateKey) {
                await sendNotificationEmail({
                    db,
                    uid,
                    to,
                    eventKey: `kyc_${after.kyc_status}_${event.id}`,
                    templateKey,
                    locale,
                    data: { name, baseUrl: APP_BASE_URL, reviewerNote: note },
                    logger,
                }).catch((e) => logger.error('KYC email failed', { uid, status: after.kyc_status, error: e.message }));
            }
        }

        // Payment transition
        if (after.payment_status && after.payment_status !== before.payment_status) {
            const templateKey = PAYMENT_TEMPLATES[after.payment_status];
            if (templateKey) {
                await sendNotificationEmail({
                    db,
                    uid,
                    to,
                    eventKey: `payment_${after.payment_status}_${event.id}`,
                    templateKey,
                    locale,
                    data: {
                        name,
                        baseUrl: APP_BASE_URL,
                        planName: after.plan_id || null,
                        amount: after.payment_amount != null ? after.payment_amount : null,
                        reviewerNote: note,
                    },
                    logger,
                }).catch((e) => logger.error('Payment email failed', { uid, status: after.payment_status, error: e.message }));
            }
        }
    },
);

// --------------------------------------------------------------------------
// Trial-ending reminders. Daily scan of billing_subscription/current docs that
// are trialing and end within the next 24h. Idempotent per trial-end day.
// --------------------------------------------------------------------------
exports.sendTrialEndingReminders = onSchedule(
    { schedule: 'every day 09:00', timeZone: 'Asia/Jakarta', secrets: [RESEND_API_KEY] },
    async () => {
        const db = admin.firestore();
        const now = Date.now();
        const windowEnd = now + 24 * 60 * 60 * 1000;

        const snap = await db
            .collectionGroup('billing_subscription')
            .where('status', '==', 'trialing')
            .get();

        let sent = 0;
        for (const doc of snap.docs) {
            if (doc.id !== 'current') continue;
            const d = doc.data();
            const ends = d.trial_ends_at && d.trial_ends_at.toMillis ? d.trial_ends_at.toMillis() : null;
            if (!ends || ends < now || ends > windowEnd) continue;

            const uid = doc.ref.parent.parent && doc.ref.parent.parent.id;
            if (!uid) continue;

            const to = await resolveUserEmail(db, uid);
            if (!to) continue;

            const locale = await resolveUserLocale(db, uid);
            const dayKey = new Date(ends).toISOString().slice(0, 10);
            await sendNotificationEmail({
                db,
                uid,
                to,
                eventKey: `trial_ending_${dayKey}`,
                templateKey: 'trial_ending',
                locale,
                data: { name: null, planName: d.plan_name || null, trialEndsLabel: formatDate(ends, locale), baseUrl: APP_BASE_URL },
                logger,
            })
                .then((r) => { if (r && r.sent) sent += 1; })
                .catch((e) => logger.error('Trial reminder failed', { uid, error: e.message }));
        }
        logger.info('Trial-ending reminder sweep complete', { candidates: snap.size, sent });
    },
);
