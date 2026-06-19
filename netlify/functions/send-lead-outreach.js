'use strict';

// Authenticated lead-outreach send, fired from the dashboard Sales Leads page.
// An authenticated user submits a lead's details and we send the bilingual
// meeting-reminder email (functions/lib/templates → lead_outreach) to that lead
// via Resend, from the outreach mailbox hello@fluxyos.com (From + Reply-To).
//
// Auth: verifies the caller's Firebase ID token, so only signed-in dashboard
// users can trigger a send. The recipient is an arbitrary lead (no uid), so we
// send Resend directly — no users/{uid}/mail_log idempotency doc (that path is
// for app-user notifications). This is a manual, one-recipient action, the same
// posture as submit-contact-sales, so it is intentionally NOT gated by
// NOTIFY_ENABLED (that flag pauses the automated backfill sweeps only).
const admin = require('firebase-admin');
const { initAdmin } = require('./lib/notify-core');
const { Resend } = require('resend');
const { buildEmail } = require('../../functions/lib/templates');

const EMAIL_FROM = 'FluxyOS <hello@fluxyos.com>';
const REPLY_TO = 'hello@fluxyos.com';
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://fluxyos.com';
const ALLOWED = ['https://fluxyos.com', 'https://www.fluxyos.com', 'http://localhost:8000', 'http://127.0.0.1:5500', 'http://127.0.0.1:8765'];

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

    try {
        // --- Auth: only a signed-in dashboard user may send ---
        const authz = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
        const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
        if (!token) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'missing token' }) };
        initAdmin();
        const decoded = await admin.auth().verifyIdToken(token);
        const senderName = str(decoded.name, 120) || 'Tim FluxyOS';

        // --- Validate the lead payload ---
        let body = {};
        try { body = JSON.parse(event.body || '{}'); } catch (_) { body = {}; }
        const name = str(body.name, 120);
        const gender = ['male', 'female'].includes(body.gender) ? body.gender : 'male';
        const email = str(body.email, 200);
        const meetingISO = str(body.meetingISO, 40);
        const meetingDt = meetingISO ? new Date(meetingISO) : null;
        if (!name || !email || !isEmail(email)) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_input' }) };
        if (!meetingDt || isNaN(meetingDt.getTime())) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_meeting' }) };

        if (!process.env.RESEND_API_KEY) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'email_not_configured' }) };

        const { subject, html, text } = buildEmail('lead_outreach', 'id', {
            name, gender, meetingISO, senderName, baseUrl: APP_BASE_URL,
        });

        const resend = new Resend(process.env.RESEND_API_KEY);
        const res = await resend.emails.send({ from: EMAIL_FROM, to: email, reply_to: REPLY_TO, subject, html, text });
        if (res && res.error) throw new Error(res.error.message || 'Resend send error');

        return { statusCode: 200, headers: cors, body: JSON.stringify({ result: 'sent', id: (res && res.data && res.data.id) || null }) };
    } catch (e) {
        console.error('[send-lead-outreach] failed:', e && e.message ? e.message : e);
        const msg = String(e && e.message ? e.message : 'server_error').slice(0, 160);
        const code = /token|auth/i.test(msg) ? 401 : 500;
        return { statusCode: code, headers: cors, body: JSON.stringify({ error: msg }) };
    }
};
