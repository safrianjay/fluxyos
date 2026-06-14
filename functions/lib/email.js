'use strict';

const admin = require('firebase-admin');
const { Resend } = require('resend');
const { buildEmail } = require('./templates');

// Non-secret config (functions/.env). The API key itself is a Secret Manager
// secret bound per-function — never a committed env value.
const EMAIL_FROM = process.env.EMAIL_FROM || 'FluxyOS <notifications@fluxyos.com>';
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'support@fluxyos.com';

let _resend = null;
function getResend() {
    if (_resend) return _resend;
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set');
    _resend = new Resend(key);
    return _resend;
}

function isAlreadyExists(err) {
    return err && (err.code === 6 || err.code === 'already-exists' || err.code === 'ALREADY_EXISTS');
}

/**
 * Send one notification email, exactly once.
 *
 * Idempotency: a placeholder doc at users/{uid}/mail_log/{eventKey} is created
 * with `.create()` (atomic fail-if-exists). A duplicate trigger delivery finds
 * the doc already there and skips. If the provider send then fails, the
 * placeholder is deleted so a later retry can resend.
 *
 * `eventKey` MUST be deterministic for a given notification (e.g. include the
 * Cloud Functions event id so redelivery dedupes, but distinct transitions
 * each send once).
 */
async function sendNotificationEmail({ db, uid, to, eventKey, templateKey, locale, data, logger }) {
    const log = logger || console;
    if (!to) {
        log.warn?.('Skip email: no recipient', { uid, templateKey });
        return { skipped: 'no_recipient' };
    }

    const logRef = db.doc(`users/${uid}/mail_log/${eventKey}`);
    try {
        await logRef.create({
            template: templateKey,
            to,
            locale: locale || 'en',
            status: 'sending',
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
        if (isAlreadyExists(err)) {
            log.info?.('Skip email: already sent', { uid, eventKey, templateKey });
            return { skipped: 'duplicate' };
        }
        throw err;
    }

    let providerId = null;
    try {
        const { subject, html, text } = buildEmail(templateKey, locale, data);
        const res = await getResend().emails.send({
            from: EMAIL_FROM,
            to,
            replyTo: REPLY_TO,
            subject,
            html,
            text,
        });
        if (res && res.error) throw new Error(res.error.message || 'Resend send error');
        providerId = (res && res.data && res.data.id) || null;
    } catch (err) {
        // Roll back the placeholder so a future invocation can retry this send.
        await logRef.delete().catch(() => {});
        log.error?.('Email send failed', { uid, eventKey, templateKey, error: err.message });
        throw err;
    }

    await logRef.set(
        { status: 'sent', provider_message_id: providerId, sent_at: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
    );

    // Best-effort audit trail, consistent with the users/{uid}/audit_logs schema.
    await db
        .collection(`users/${uid}/audit_logs`)
        .add({
            actor_uid: uid,
            actor_role: null,
            action: 'notification.email_sent',
            target_collection: 'mail_log',
            target_id: eventKey,
            before: null,
            after: { template: templateKey, to },
            reason: null,
            source: 'system',
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        })
        .catch((e) => log.warn?.('Audit log write failed', { uid, eventKey, error: e.message }));

    log.info?.('Email sent', { uid, eventKey, templateKey, providerId });
    return { sent: true, providerId };
}

module.exports = { sendNotificationEmail, EMAIL_FROM, REPLY_TO };
