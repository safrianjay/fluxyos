'use strict';

/**
 * No-Blaze notification core.
 *
 * Runs on Netlify (Scheduled Functions) instead of Firebase Cloud Functions,
 * so it needs no Blaze plan. Uses the Firebase Admin SDK (service-account key in
 * the FIREBASE_SERVICE_ACCOUNT env var) to read state and write the idempotency
 * log, and reuses the SAME templates/sender as functions/lib (one source of
 * truth). Sending goes through Resend.
 *
 * Two sweeps:
 *  - reconcileInternalUsers: welcome + KYC + payment, from internal_users.
 *  - sweepTrialEnding: trial-ending, from billing_subscription/current.
 */

const admin = require('firebase-admin');

// Reuse the committed Cloud Functions logic verbatim.
const { sendNotificationEmail } = require('../../../functions/lib/email');
const { resolveUserLocale } = require('../../../functions/lib/locale');
const { formatDate, firstName } = require('../../../functions/lib/format');

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://fluxyos.com';

// Welcome guardrails — never retro-email existing users on first deploy.
const WELCOME_MAX_AGE_MS = Number(process.env.WELCOME_MAX_AGE_MS || 2 * 60 * 60 * 1000); // 2h
const WELCOME_AFTER = process.env.WELCOME_AFTER ? Date.parse(process.env.WELCOME_AFTER) : null;

// KYC/payment recency cutoff — never email a decision reviewed before this.
// Defaults to WELCOME_AFTER so one env protects every backfill vector even if
// the idempotency log is ever lost.
const NOTIFY_AFTER = process.env.NOTIFY_AFTER ? Date.parse(process.env.NOTIFY_AFTER) : WELCOME_AFTER;

// Optional promo featured in the welcome email. Disabled when no code is set.
const WELCOME_OFFER = process.env.WELCOME_OFFER_CODE
    ? { code: process.env.WELCOME_OFFER_CODE, percent: Number(process.env.WELCOME_OFFER_PERCENT || 0), terms: process.env.WELCOME_OFFER_TERMS || '' }
    : null;

const KYC_TEMPLATES = { approved: 'kyc_approved', needs_revision: 'kyc_needs_revision', rejected: 'kyc_rejected' };
const PAYMENT_TEMPLATES = { verified: 'payment_verified', rejected: 'payment_rejected' };

let _initialized = false;
function initAdmin() {
    if (!_initialized) {
        if (!admin.apps.length) {
            const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
            if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
            admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
        }
        _initialized = true;
    }
    return admin.firestore();
}

function toMillis(ts) {
    return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null;
}

// Deterministic idempotency key. Including the review timestamp lets a genuine
// re-decision (e.g. needs_revision -> approved) send again, while trigger
// retries within a sweep dedupe.
function eventKey(prefix, status, ts) {
    const m = toMillis(ts);
    return m ? `${prefix}_${status}_${m}` : `${prefix}_${status}`;
}

function welcomeEligible(u) {
    const created = toMillis(u.created_at);
    if (!created) return false;
    if (WELCOME_AFTER && created < WELCOME_AFTER) return false;
    return Date.now() - created <= WELCOME_MAX_AGE_MS;
}

// True when a KYC/payment review is recent enough to notify. With a cutoff set,
// the review timestamp must exist AND be >= cutoff, so legacy or pre-cutoff
// decisions are never back-emailed even on an empty idempotency log.
function passesNotifyCutoff(ts) {
    if (!NOTIFY_AFTER) return true;
    const m = toMillis(ts);
    return m != null && m >= NOTIFY_AFTER;
}

// Welcome + KYC + payment, derived from the internal index. Per-user failures
// are isolated so one bad row never aborts the sweep.
async function reconcileInternalUsers(db, { logger = console, limit = 500 } = {}) {
    const snap = await db.collection('internal_users').limit(limit).get();
    let sent = 0;
    for (const doc of snap.docs) {
        const uid = doc.id;
        const u = doc.data() || {};
        const to = u.email;
        if (!to) continue;

        try {
            const locale = await resolveUserLocale(db, uid);
            const name = firstName(u.display_name);
            const note = u.last_internal_note || null;

            if (welcomeEligible(u)) {
                const r = await sendNotificationEmail({
                    db, uid, to, eventKey: 'welcome', templateKey: 'welcome', locale,
                    data: {
                        name,
                        baseUrl: APP_BASE_URL,
                        kycComplete: u.kyc_status === 'approved',
                        onboardingComplete: !!u.onboarding_completed,
                        offer: WELCOME_OFFER,
                    },
                    logger,
                });
                if (r && r.sent) sent += 1;
            }

            const kycTemplate = KYC_TEMPLATES[u.kyc_status];
            if (kycTemplate && passesNotifyCutoff(u.kyc_reviewed_at)) {
                const r = await sendNotificationEmail({ db, uid, to, eventKey: eventKey('kyc', u.kyc_status, u.kyc_reviewed_at), templateKey: kycTemplate, locale, data: { name, baseUrl: APP_BASE_URL, reviewerNote: note }, logger });
                if (r && r.sent) sent += 1;
            }

            const paymentTemplate = PAYMENT_TEMPLATES[u.payment_status];
            if (paymentTemplate) {
                const ts = u.payment_reviewed_at || u.payment_verified_at || u.payment_submitted_at;
                if (passesNotifyCutoff(ts)) {
                    const r = await sendNotificationEmail({ db, uid, to, eventKey: eventKey('payment', u.payment_status, ts), templateKey: paymentTemplate, locale, data: { name, baseUrl: APP_BASE_URL, planName: u.plan_id || null, amount: u.payment_amount != null ? u.payment_amount : null, reviewerNote: note }, logger });
                    if (r && r.sent) sent += 1;
                }
            }
        } catch (e) {
            (logger.error || console.error)('reconcileInternalUsers: user failed', { uid, error: e.message });
        }
    }
    (logger.info || console.log)('reconcileInternalUsers complete', { scanned: snap.size, sent });
    return { scanned: snap.size, sent };
}

// Trial-ending reminders — billing_subscription/current that is trialing and
// ends within the next 24h. Idempotent per trial-end day.
async function sweepTrialEnding(db, { logger = console } = {}) {
    const now = Date.now();
    const windowEnd = now + 24 * 60 * 60 * 1000;

    const snap = await db.collectionGroup('billing_subscription').where('status', '==', 'trialing').get();
    let sent = 0;
    for (const doc of snap.docs) {
        if (doc.id !== 'current') continue;
        const d = doc.data() || {};
        const ends = toMillis(d.trial_ends_at);
        if (!ends || ends < now || ends > windowEnd) continue;

        const uid = doc.ref.parent.parent && doc.ref.parent.parent.id;
        if (!uid) continue;

        try {
            const to = await resolveUserEmail(db, uid);
            if (!to) continue;
            const locale = await resolveUserLocale(db, uid);
            const dayKey = new Date(ends).toISOString().slice(0, 10);
            const r = await sendNotificationEmail({ db, uid, to, eventKey: `trial_ending_${dayKey}`, templateKey: 'trial_ending', locale, data: { name: null, planName: d.plan_name || null, trialEndsLabel: formatDate(ends, locale), baseUrl: APP_BASE_URL }, logger });
            if (r && r.sent) sent += 1;
        } catch (e) {
            (logger.error || console.error)('sweepTrialEnding: user failed', { uid, error: e.message });
        }
    }
    (logger.info || console.log)('sweepTrialEnding complete', { candidates: snap.size, sent });
    return { candidates: snap.size, sent };
}

// Email lookup: Auth first, then the internal index.
async function resolveUserEmail(db, uid) {
    try {
        const u = await admin.auth().getUser(uid);
        if (u && u.email) return u.email;
    } catch (_e) { /* fall through */ }
    try {
        const snap = await db.doc(`internal_users/${uid}`).get();
        if (snap.exists && snap.data().email) return snap.data().email;
    } catch (_e) { /* ignore */ }
    return null;
}

module.exports = { initAdmin, reconcileInternalUsers, sweepTrialEnding, resolveUserEmail, KYC_TEMPLATES, PAYMENT_TEMPLATES };
