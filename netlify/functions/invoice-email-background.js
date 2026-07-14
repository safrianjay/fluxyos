'use strict';

// =============================================================================
// Invoice auto-email — delivery runner (Netlify background function)
//
// Name ends `-background` ⇒ ~15-min budget + larger bundle, which is why the
// headless-Chromium PDF renderer (lib/invoice-pdf.js) is required ONLY here.
// Triggered by (a) enqueue-invoice-email.js for an instant send on finalize and
// (b) invoice-email-worker.js for backoff retries — both via the INTERNAL_API_
// TOKEN shared-secret header (same contract as commerce-sync-background.js).
//
// For a claimed job it: re-reads the invoice, renders the PDF, sends via the
// shared Resend pipeline (functions/lib/email.js, exactly-once mail_log +
// attachment), records the attempt, and on success completes the job / on
// failure backs off or dead-letters (notifying the workspace owner once).
// =============================================================================

const admin = require('firebase-admin');
const { initAdmin } = require('./lib/notify-core');
const { sendNotificationEmail, EMAIL_FROM } = require('../../functions/lib/email');
const { resolveUserLocale } = require('../../functions/lib/locale');
const jobs = require('./lib/invoice-email/jobs');
const { renderInvoicePdf } = require('./lib/invoice-pdf');

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://dashboard.fluxyos.com';

function toMillis(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    return null;
}
function fmtDate(v, locale) {
    const ms = toMillis(v);
    if (ms == null) return '';
    return new Date(ms).toLocaleDateString(locale === 'id' ? 'id-ID' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}
// A malformed recipient can never succeed on retry — dead-letter immediately.
function isPermanent(err) {
    return /(invalid|malformed).*(email|recipient|address|to field)/i.test(String(err && err.message ? err.message : err));
}
function sanitizeFilename(s) {
    return String(s || 'invoice').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80);
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'method not allowed' };
    if (process.env.INVOICE_EMAIL_ENABLED !== 'true') return { statusCode: 503, body: 'disabled' };
    const provided = event.headers['x-internal-token'] || event.headers['X-Internal-Token'];
    if (!process.env.INTERNAL_API_TOKEN || provided !== process.env.INTERNAL_API_TOKEN) {
        return { statusCode: 401, body: 'unauthorized' };
    }

    let payload;
    try { payload = JSON.parse(event.body || '{}'); } catch (_) { payload = {}; }
    const { workspace_id: workspaceId, job_id: jobId } = payload;
    if (!workspaceId || !jobId) return { statusCode: 400, body: 'workspace_id and job_id required' };

    const db = initAdmin();
    const jobRef = jobs.jobsCol(db, workspaceId).doc(jobId);
    const snap = await jobRef.get();
    if (!snap.exists) return { statusCode: 404, body: 'job not found' };
    let job = snap.data();

    // The worker claims pending→processing before delegating; also accept a
    // still-pending job (direct trigger), claiming it here.
    if (job.status === 'pending') {
        const claimed = await jobs.claimJob(db, jobRef);
        if (!claimed) return { statusCode: 409, body: 'job already claimed' };
        job = claimed;
    } else if (job.status !== 'processing') {
        return { statusCode: 409, body: `job is ${job.status}` };
    }

    const ownerUid = job.created_by || null;
    try {
        // Re-read the invoice + items server-side.
        const invRef = db.doc(`workspaces/${workspaceId}/invoices/${job.invoice_id}`);
        const invSnap = await invRef.get();
        if (!invSnap.exists) throw Object.assign(new Error('invoice_not_found'), { permanent: true });
        const invoice = invSnap.data() || {};

        // Skip cleanly if the invoice is no longer sendable (voided/paid between
        // enqueue and send). Complete the job without an email or an error.
        if (invoice.status !== 'open') {
            await jobs.completeJob(jobRef, {});
            await jobRef.update({ last_error: `skipped_status_${invoice.status}` }).catch(() => {});
            return { statusCode: 200, body: JSON.stringify({ skipped: `status_${invoice.status}` }) };
        }

        const itemsSnap = await invRef.collection('items').orderBy('position', 'asc').get().catch(() => null);
        const items = itemsSnap ? itemsSnap.docs.map((d) => d.data()) : [];

        // Business name + per-workspace email customization.
        const wsSnap = await db.doc(`workspaces/${workspaceId}`).get();
        const businessName = (wsSnap.exists && (wsSnap.data() || {}).name) || 'FluxyOS';
        const cfgSnap = await db.doc(`workspaces/${workspaceId}/settings/invoice_email`).get().catch(() => null);
        const cfg = (cfgSnap && cfgSnap.exists && cfgSnap.data()) || {};

        // Customer's language drives the (localized, not bilingual) email + PDF.
        const locale = /^(id|ind|bahasa)/i.test(String(invoice.customer_language || '')) ? 'id' : 'en';
        const dueDateText = fmtDate(invoice.due_date, locale);

        // Render the PDF (headless Chromium).
        const pdf = await renderInvoicePdf({
            invoice, items, businessName, locale, logoUrl: cfg.logo_url || null,
        });

        // Template tokens for the custom subject.
        const subjectTemplate = typeof cfg.subject_template === 'string' ? cfg.subject_template : '';
        const subject = subjectTemplate
            ? subjectTemplate
                .replace(/\{\{\s*invoice_number\s*\}\}/g, invoice.invoice_number || '')
                .replace(/\{\{\s*business_name\s*\}\}/g, businessName)
            : '';

        const from = cfg.sender_name
            ? `${String(cfg.sender_name).slice(0, 80)} <${(EMAIL_FROM.match(/<(.+)>/) || [])[1] || 'notifications@fluxyos.com'}>`
            : undefined;

        // eventKey: auto = once per issuance (retries dedupe); manual = per job.
        const eventKey = job.type === 'manual'
            ? `invoice_email_${job.invoice_id}_resend_${jobId}`
            : `invoice_email_${job.invoice_id}_issue`;

        const filename = `${sanitizeFilename(invoice.invoice_number || 'invoice')}.pdf`;
        const result = await sendNotificationEmail({
            db,
            uid: ownerUid || workspaceId, // mail_log/audit are keyed under the sender (owner)
            to: job.to,
            eventKey,
            templateKey: 'invoice_email',
            locale,
            data: {
                businessName,
                invoiceNumber: invoice.invoice_number,
                customerName: invoice.customer_name,
                amountDue: invoice.amount_due,
                currency: invoice.currency || 'IDR',
                dueDateText,
                message: cfg.message || '',
                subject,
                logoUrl: cfg.logo_url || null,
                baseUrl: APP_BASE_URL,
            },
            from,
            replyTo: cfg.reply_to || undefined,
            attachments: [{ filename, content: pdf.toString('base64') }],
        });

        const providerId = (result && (result.providerId || (result.skipped ? 'duplicate' : null))) || null;
        await jobs.completeJob(jobRef, { providerMessageId: providerId });
        await jobs.recordAttempt(jobRef, {
            attemptNumber: job.attempts, to: job.to, status: 'sent', providerMessageId: providerId,
        });
        console.log('[invoice-email-background] sent', jobId, result && result.skipped ? '(dedup)' : '');
        return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
        const permanent = Boolean(e && e.permanent) || isPermanent(e);
        const { dead } = await jobs.failJob(jobRef, job, e, { permanentError: permanent });
        await jobs.recordAttempt(jobRef, {
            attemptNumber: job.attempts, to: job.to, status: 'failed', error: e && e.message ? e.message : String(e),
        });
        if (dead) {
            await notifyOwnerOfFailure(db, { workspaceId, jobRef, job, ownerUid, error: e }).catch((n) => {
                console.warn('[invoice-email-background] owner notify failed', n.message);
            });
        }
        console.error('[invoice-email-background] failed', jobId, e && e.message ? e.message : e, dead ? '(dead)' : '');
        return { statusCode: 500, body: 'send failed' };
    }
};

// One-time owner alert when all retries are exhausted (dead). Guarded by the
// job's notified_user_of_failure flag so a re-drain can't re-notify.
async function notifyOwnerOfFailure(db, { workspaceId, jobRef, job, ownerUid, error }) {
    if (!ownerUid || job.notified_user_of_failure) return;
    // Claim the notify slot first (idempotent under concurrent drains).
    await jobRef.update({ notified_user_of_failure: true });

    const ownerSnap = await admin.auth().getUser(ownerUid).catch(() => null);
    const ownerEmail = ownerSnap && ownerSnap.email;
    if (!ownerEmail) return;

    const invSnap = await db.doc(`workspaces/${workspaceId}/invoices/${job.invoice_id}`).get().catch(() => null);
    const invoiceNumber = (invSnap && invSnap.exists && (invSnap.data() || {}).invoice_number) || job.invoice_id;
    const locale = await resolveUserLocale(db, ownerUid).catch(() => 'en');

    await sendNotificationEmail({
        db,
        uid: ownerUid,
        to: ownerEmail,
        eventKey: `invoice_email_failed_${jobRef.id}`,
        templateKey: 'invoice_email_failed',
        locale,
        data: {
            invoiceNumber,
            customerEmail: job.to,
            viewUrl: `${APP_BASE_URL}/invoices?invoice=${encodeURIComponent(job.invoice_id)}`,
            errorMessage: error && error.message ? error.message : String(error),
            baseUrl: APP_BASE_URL,
        },
    });
}
