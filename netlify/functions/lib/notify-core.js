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
    ? { code: process.env.WELCOME_OFFER_CODE, percent: Number(process.env.WELCOME_OFFER_PERCENT || 0), terms: process.env.WELCOME_OFFER_TERMS || '', validDays: Number(process.env.WELCOME_OFFER_VALID_DAYS || 14) }
    : null;

const KYC_TEMPLATES = { approved: 'kyc_approved', needs_revision: 'kyc_needs_revision', rejected: 'kyc_rejected' };
const PAYMENT_TEMPLATES = { verified: 'payment_verified', rejected: 'payment_rejected' };

// Internal ops alerts. Every new signup and every new KYC submission is emailed
// to the reviewer, because the KYC gate now BLOCKS the whole product until
// someone approves — a queue nobody is watching means a locked-out customer.
const KYC_ALERT_EMAIL = process.env.KYC_ALERT_EMAIL || 'safrian@fluxyos.com';
// How fresh an event must be to alert. This is the backfill guard — see the
// call site in reconcileInternalUsers.
const INTERNAL_ALERT_MAX_AGE_MS = Number(process.env.INTERNAL_ALERT_MAX_AGE_MS || 6 * 60 * 60 * 1000); // 6h
const ESC = (s) => String(s == null ? '—' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtTs(ts) {
    const m = toMillis(ts);
    return m ? new Date(m).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—';
}

// Which internal alerts (if any) this roster row is due. Pure and exported so
// the backfill guard is testable — tests/kyc-alert-backfill.check.js feeds it
// the shape of the real production roster and asserts it stays silent. The
// recency windows here are the ONLY thing standing between a deploy and one
// email per existing user.
function internalAlertFlags(u, now = Date.now()) {
    const submittedMs = toMillis(u.kyc_submitted_at);
    return {
        signup: welcomeEligible(u, now),
        submission: u.kyc_status === 'submitted'
            && submittedMs != null
            && now - submittedMs <= INTERNAL_ALERT_MAX_AGE_MS
            && passesNotifyCutoff(u.kyc_submitted_at),
    };
}

// The reviewer's whole job is comparing these fields, so the alert carries them
// inline — opening the console should be for the decision, not the reading.
function buildInternalAlert(kind, uid, u, profile, documents) {
    const isNewUser = kind === 'signup';
    const rows = [
        ['Firebase UID', uid],
        ['Email', u.email],
        ['Display name', u.display_name],
        ['Business name', profile?.business_name || u.business_name],
        ['Legal full name', profile?.legal_full_name],
        ['Phone / WhatsApp', profile ? [profile.phone_country_code, profile.phone_number].filter(Boolean).join(' ') : u.phone_number],
        ['Role', profile?.role || u.role],
        ['Main goal', profile?.main_goal],
        ['Monthly revenue', profile?.monthly_revenue_range],
        ['Employees', profile?.employee_count_range],
        ['Identity document', documents?.identity_document_status === 'uploaded' ? (documents.identity_document_file_name || 'uploaded') : 'NOT UPLOADED'],
        ['Business document', documents?.business_document_status === 'uploaded' ? (documents.business_document_file_name || 'uploaded') : 'not uploaded'],
        ['KYC status', u.kyc_status],
        ['Submitted', fmtTs(u.kyc_submitted_at)],
        ['Signed up', fmtTs(u.created_at)],
    ];
    const body = rows
        .map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6B7280;white-space:nowrap">${ESC(k)}</td><td style="padding:4px 0;color:#111827">${ESC(v)}</td></tr>`)
        .join('');
    return {
        subject: isNewUser
            ? `New FluxyOS signup — ${profile?.business_name || u.email || uid}`
            : `KYC submitted — ${profile?.business_name || u.email || uid}`,
        html: `<h2 style="margin:0 0 4px;font:600 18px system-ui">${isNewUser ? 'New signup' : 'New KYC submission'}</h2>
            <p style="margin:0 0 16px;color:#6B7280;font:14px system-ui">${isNewUser
                ? 'This account has registered. It stays locked until KYC is submitted and approved.'
                : 'This account is locked out of FluxyOS until you approve or reject it.'}</p>
            <table style="border-collapse:collapse;font:14px system-ui">${body}</table>
            <p style="margin:20px 0 0"><a href="${APP_BASE_URL}/internal" style="display:inline-block;background:#0B0F19;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font:600 14px system-ui">Open KYC Review</a></p>`,
        text: `${isNewUser ? 'New signup' : 'New KYC submission'}\n\n`
            + rows.map(([k, v]) => `${k}: ${v == null ? '—' : v}`).join('\n')
            + `\n\nReview: ${APP_BASE_URL}/internal`,
    };
}

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

function welcomeEligible(u, now = Date.now()) {
    const created = toMillis(u.created_at);
    if (!created) return false;
    if (WELCOME_AFTER && created < WELCOME_AFTER) return false;
    return now - created <= WELCOME_MAX_AGE_MS;
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

            // ---- Internal ops alerts (to the reviewer, not the customer) ----
            // RECENCY IS THE BACKFILL GUARD, and it is load-bearing: every user
            // already on the roster sits at kyc_status 'submitted' unreviewed, so
            // a status-only condition would blast one email per existing user on
            // the first sweep. Both branches require a fresh timestamp, so only
            // genuinely new events alert. mail_log dedupes the rest.
            const { signup: signupFresh, submission: submissionFresh } = internalAlertFlags(u);

            if (signupFresh || submissionFresh) {
                // Only read the onboarding docs when we are actually sending —
                // otherwise this would be 2 extra reads per user per sweep.
                const [profileSnap, documentsSnap] = await Promise.all([
                    db.doc(`users/${uid}/onboarding/profile`).get().catch(() => null),
                    db.doc(`users/${uid}/onboarding/documents`).get().catch(() => null),
                ]);
                const profile = profileSnap && profileSnap.exists ? profileSnap.data() : null;
                const documents = documentsSnap && documentsSnap.exists ? documentsSnap.data() : null;

                if (signupFresh) {
                    const built = buildInternalAlert('signup', uid, u, profile, documents);
                    const r = await sendNotificationEmail({
                        db, uid, to: KYC_ALERT_EMAIL, eventKey: 'internal_signup',
                        locale: 'en', replyTo: u.email || undefined,
                        prebuilt: { ...built, template: 'internal_signup_alert' }, logger,
                    });
                    if (r && r.sent) sent += 1;
                }
                if (submissionFresh) {
                    const built = buildInternalAlert('kyc_submitted', uid, u, profile, documents);
                    const r = await sendNotificationEmail({
                        db, uid, to: KYC_ALERT_EMAIL, eventKey: eventKey('internal_kyc', 'submitted', u.kyc_submitted_at),
                        locale: 'en', replyTo: u.email || undefined,
                        prebuilt: { ...built, template: 'internal_kyc_alert' }, logger,
                    });
                    if (r && r.sent) sent += 1;
                }
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
            const r = await sendNotificationEmail({ db, uid, to, eventKey: `trial_ending_${dayKey}`, templateKey: 'trial_ending', locale, data: { name: null, planName: d.plan_name || null, trialEndsLabel: formatDate(ends, locale), baseUrl: APP_BASE_URL, offer: WELCOME_OFFER }, logger });
            if (r && r.sent) sent += 1;
        } catch (e) {
            (logger.error || console.error)('sweepTrialEnding: user failed', { uid, error: e.message });
        }
    }
    (logger.info || console.log)('sweepTrialEnding complete', { candidates: snap.size, sent });
    return { candidates: snap.size, sent };
}

// Billing / repayment reminders + account-locked, off billing_subscription/current.
// Fires by calendar-day offset from current_period_end: 7d before (upcoming),
// 1d before (due_soon), 3d after (overdue), 7d after (account_locked). Renewed
// subs move period_end forward, so overdue/lock only hit genuinely-unpaid users.
// Idempotent per period-end date + phase.
async function sweepBillingReminders(db, { now = new Date(), logger = console } = {}) {
    const DAY = 24 * 60 * 60 * 1000;
    const dateKey = (ms) => new Date(ms).toISOString().slice(0, 10);
    const midnightUTC = (ms) => { const dt = new Date(ms); return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()); };
    const todayMid = midnightUTC(now.getTime());

    const snap = await db.collectionGroup('billing_subscription').get();
    let sent = 0;
    for (const doc of snap.docs) {
        if (doc.id !== 'current') continue;
        const d = doc.data() || {};
        if (String(d.status || '') === 'trialing') continue; // trials use trial_ending
        const endMs = d.current_period_end && d.current_period_end.toMillis ? d.current_period_end.toMillis() : null;
        if (!endMs) continue;
        const diffDays = Math.round((midnightUTC(endMs) - todayMid) / DAY);

        let templateKey = 'billing_reminder'; let phase = null;
        if (diffDays === 7) phase = 'upcoming';
        else if (diffDays === 1) phase = 'due_soon';
        else if (diffDays === -3) phase = 'overdue';
        else if (diffDays === -7) { templateKey = 'account_locked'; }
        else continue;

        const uid = doc.ref.parent.parent && doc.ref.parent.parent.id;
        if (!uid) continue;
        try {
            const to = await resolveUserEmail(db, uid);
            if (!to) continue;
            const locale = await resolveUserLocale(db, uid);
            const eventKey = phase ? `billing_${phase}_${dateKey(endMs)}` : `account_locked_${dateKey(endMs)}`;
            const data = { name: null, baseUrl: APP_BASE_URL, phase, planName: d.plan_name || null, amount: d.payment_amount != null ? d.payment_amount : null, dueLabel: formatDate(endMs, locale) };
            const r = await sendNotificationEmail({ db, uid, to, eventKey, templateKey, locale, data, logger });
            if (r && r.sent) sent += 1;
        } catch (e) {
            (logger.error || console.error)('sweepBillingReminders: user failed', { uid, error: e.message });
        }
    }
    (logger.info || console.log)('sweepBillingReminders complete', { candidates: snap.size, sent });
    return { candidates: snap.size, sent };
}

// "Finish your QRIS payment" reminder — payment requests still awaiting_payment
// (new plan / repayment / upgrade). Sent once per request, a few hours after it
// was created and before the ~24h window closes. CTA returns to the QR screen.
async function sweepPendingPayments(db, { now = new Date(), logger = console } = {}) {
    const HOUR = 60 * 60 * 1000;
    const snap = await db.collectionGroup('billing_payment_requests').where('payment_status', '==', 'awaiting_payment').get();
    let sent = 0;
    for (const doc of snap.docs) {
        const d = doc.data() || {};
        const createdMs = d.created_at && d.created_at.toMillis ? d.created_at.toMillis() : null;
        if (!createdMs) continue;
        const ageH = (now.getTime() - createdMs) / HOUR;
        if (ageH < 3 || ageH > 26) continue;
        const uid = doc.ref.parent.parent && doc.ref.parent.parent.id;
        if (!uid) continue;
        try {
            const to = await resolveUserEmail(db, uid);
            if (!to) continue;
            const locale = await resolveUserLocale(db, uid);
            const r = await sendNotificationEmail({
                db, uid, to, eventKey: `payment_pending_${doc.id}`, templateKey: 'payment_pending_reminder', locale,
                data: { name: null, baseUrl: APP_BASE_URL, requestId: doc.id, planName: d.plan_name || d.plan_id || null, amount: d.total_amount != null ? d.total_amount : null },
                logger,
            });
            if (r && r.sent) sent += 1;
        } catch (e) {
            (logger.error || console.error)('sweepPendingPayments: request failed', { reqId: doc.id, error: e.message });
        }
    }
    (logger.info || console.log)('sweepPendingPayments complete', { candidates: snap.size, sent });
    return { candidates: snap.size, sent };
}

// Immediate "Payment received — under review" when a request hits
// pending_verification. Recency-guarded (≤48h) so old pending requests are not
// back-emailed on first run; one email per request.
async function sweepSubmittedPayments(db, { now = new Date(), logger = console } = {}) {
    const HOUR = 60 * 60 * 1000;
    const snap = await db.collectionGroup('billing_payment_requests').where('payment_status', '==', 'pending_verification').get();
    let sent = 0;
    for (const doc of snap.docs) {
        const d = doc.data() || {};
        const submittedMs = (d.submitted_for_verification_at && d.submitted_for_verification_at.toMillis ? d.submitted_for_verification_at.toMillis() : null)
            || (d.created_at && d.created_at.toMillis ? d.created_at.toMillis() : null);
        if (!submittedMs || (now.getTime() - submittedMs) > 48 * HOUR) continue;
        const uid = doc.ref.parent.parent && doc.ref.parent.parent.id;
        if (!uid) continue;
        try {
            const to = await resolveUserEmail(db, uid);
            if (!to) continue;
            const locale = await resolveUserLocale(db, uid);
            const r = await sendNotificationEmail({
                db, uid, to, eventKey: `payment_received_${doc.id}`, templateKey: 'payment_under_review', locale,
                data: { name: null, baseUrl: APP_BASE_URL, requestId: doc.id, planName: d.plan_name || d.plan_id || null, amount: d.total_amount != null ? d.total_amount : null },
                logger,
            });
            if (r && r.sent) sent += 1;
        } catch (e) {
            (logger.error || console.error)('sweepSubmittedPayments: request failed', { reqId: doc.id, error: e.message });
        }
    }
    (logger.info || console.log)('sweepSubmittedPayments complete', { candidates: snap.size, sent });
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

module.exports = { initAdmin, reconcileInternalUsers, sweepTrialEnding, sweepBillingReminders, sweepPendingPayments, sweepSubmittedPayments, resolveUserEmail, internalAlertFlags, buildInternalAlert, KYC_ALERT_EMAIL, KYC_TEMPLATES, PAYMENT_TEMPLATES };
