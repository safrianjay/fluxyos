'use strict';

// Enqueue an invoice auto-email (request-driven). Called by invoices.js when
// the user clicks "Finalize and send" (type 'auto') and by the Resend button in
// the invoice detail view (type 'manual'). Auth/authorize/soft-fail shape copied
// from send-team-invite.js: verify the caller's Firebase ID token, confirm via
// the Admin SDK that they are an active finance-capable member of the target
// workspace, re-read the invoice server-side (never trust the client for the
// recipient), then enqueue an idempotent delivery job and kick the background
// render+send. It NEVER sends mail itself. Gated by default-off
// INVOICE_EMAIL_ENABLED so it can never blast.

const admin = require('firebase-admin');
const { initAdmin } = require('./lib/notify-core');
const jobs = require('./lib/invoice-email/jobs');
const { delegateToBackground } = require('./lib/invoice-email/delegate');

const ALLOWED = ['https://fluxyos.com', 'https://dashboard.fluxyos.com', 'https://www.fluxyos.com', 'http://localhost:8000', 'http://127.0.0.1:5500', 'http://127.0.0.1:8765'];
const SEND_ROLES = ['owner', 'admin', 'finance', 'accountant'];
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    const cors = {
        'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : 'https://fluxyos.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method not allowed' };

    // Default-off kill switch. Soft-fail (200) so the client treats it as
    // "invoice issued, email skipped" rather than a hard error.
    if (process.env.INVOICE_EMAIL_ENABLED !== 'true') {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ skipped: 'disabled' }) };
    }

    try {
        const authz = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
        const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
        if (!token) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'missing token' }) };

        const db = initAdmin();
        const decoded = await admin.auth().verifyIdToken(token);
        const callerUid = decoded.uid;

        const body = JSON.parse(event.body || '{}');
        const workspaceId = str(body.workspaceId, 200);
        const invoiceId = str(body.invoiceId, 200);
        const type = body.type === 'manual' ? 'manual' : 'auto';
        if (!workspaceId || !invoiceId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_input' }) };

        // Authorize: caller must be an active finance-capable member.
        const callerSnap = await db.doc(`workspaces/${workspaceId}/members/${callerUid}`).get();
        if (!callerSnap.exists) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'not_a_member' }) };
        const caller = callerSnap.data() || {};
        if (caller.status !== 'active' || !SEND_ROLES.includes(caller.role)) {
            return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'forbidden' }) };
        }

        // Re-read the invoice server-side — the client never supplies the recipient.
        const invSnap = await db.doc(`workspaces/${workspaceId}/invoices/${invoiceId}`).get();
        if (!invSnap.exists) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'invoice_not_found' }) };
        const invoice = invSnap.data() || {};

        // Only finalized (open) invoices are emailable; a voided/paid/draft
        // invoice is skipped cleanly (the invoice itself was still created).
        if (invoice.status !== 'open') {
            return { statusCode: 200, headers: cors, body: JSON.stringify({ skipped: 'not_open' }) };
        }
        const to = str(invoice.customer_email, 200);
        if (!to || !isEmail(to)) {
            return { statusCode: 200, headers: cors, body: JSON.stringify({ skipped: 'no_customer_email' }) };
        }

        // Deterministic job id: auto is once-per-issuance (double-submit → one
        // job, ALREADY_EXISTS swallowed); manual is a fresh job per click.
        const jobId = type === 'manual' ? `manual_${invoiceId}_${Date.now()}` : `auto_${invoiceId}`;
        const { created, id } = await jobs.enqueueJob(db, workspaceId, {
            invoiceId,
            type,
            to,
            createdBy: invoice.created_by || callerUid,
        }, { jobId });

        // Kick the background render+send now (fire-and-forget). If it can't be
        // reached, the pending job is picked up by the scheduled retry sweep.
        if (created) {
            await delegateToBackground(workspaceId, id).catch(() => {});
        }

        return { statusCode: 200, headers: cors, body: JSON.stringify({ enqueued: true, jobId: id, created }) };
    } catch (e) {
        console.error('[enqueue-invoice-email] failed:', e && e.message ? e.message : e);
        // Soft-fail: the invoice is already issued; the user can resend later.
        return { statusCode: 200, headers: cors, body: JSON.stringify({ error: String(e && e.message ? e.message : 'server_error').slice(0, 160) }) };
    }
};
