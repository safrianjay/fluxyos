'use strict';

// Instant "Payment received — under review" email, fired by the client the
// moment a payment is submitted (payment-pending.js). Authenticated: it verifies
// the caller's Firebase ID token and only emails THAT user, for THEIR own
// payment request, and only when the request is actually pending_verification.
// Idempotent with the 5-min sweep (same mail_log key), so no double-send.
const admin = require('firebase-admin');
const { initAdmin } = require('./lib/notify-core');
const { sendNotificationEmail } = require('../../functions/lib/email');
const { resolveUserLocale } = require('../../functions/lib/locale');

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://fluxyos.com';
const ALLOWED = ['https://fluxyos.com', 'https://www.fluxyos.com', 'http://localhost:8000', 'http://127.0.0.1:5500'];

exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    const cors = {
        'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : 'https://fluxyos.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method not allowed' };
    if (process.env.NOTIFY_ENABLED !== 'true') return { statusCode: 200, headers: cors, body: JSON.stringify({ skipped: 'disabled' }) };

    try {
        const authz = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
        const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
        if (!token) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'missing token' }) };

        const db = initAdmin();
        const decoded = await admin.auth().verifyIdToken(token);
        const uid = decoded.uid;
        const to = decoded.email;
        const requestId = String((JSON.parse(event.body || '{}').requestId) || '').slice(0, 200);
        if (!requestId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'missing requestId' }) };
        if (!to) return { statusCode: 200, headers: cors, body: JSON.stringify({ skipped: 'no_email' }) };

        const snap = await db.doc(`users/${uid}/billing_payment_requests/${requestId}`).get();
        if (!snap.exists) return { statusCode: 200, headers: cors, body: JSON.stringify({ skipped: 'not_found' }) };
        const d = snap.data() || {};
        if (String(d.status || '') !== 'pending_verification') return { statusCode: 200, headers: cors, body: JSON.stringify({ skipped: 'not_pending' }) };

        const locale = await resolveUserLocale(db, uid);
        const r = await sendNotificationEmail({
            db, uid, to, eventKey: `payment_received_${requestId}`, templateKey: 'payment_under_review', locale,
            data: { name: null, baseUrl: APP_BASE_URL, requestId, planName: d.plan_name || d.plan_id || null, amount: d.amount != null ? d.amount : null },
        });
        return { statusCode: 200, headers: cors, body: JSON.stringify({ result: r.sent ? 'sent' : (r.skipped || 'ok') }) };
    } catch (e) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ error: String(e.message).slice(0, 120) }) };
    }
};
