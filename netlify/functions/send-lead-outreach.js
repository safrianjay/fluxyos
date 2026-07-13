'use strict';

// Lead-outreach send, triggered from the Internal Operations Console
// (internal.html → Sales Leads → Outreach subpage). Renders the bilingual
// meeting-reminder email (functions/lib/templates → lead_outreach) and sends it
// via Resend from the outreach mailbox hello@fluxyos.com (From + Reply-To).
//
// Auth: the internal console has no Firebase Auth (MVP client-side credential
// gate only), so this endpoint is gated by a shared INTERNAL_API_TOKEN that the
// console passes in the `x-internal-token` header. This matches the console's
// MVP_INTERNAL_ONLY_TEMPORARY posture — it is NOT production-grade and should
// move to a server-verified admin session along with the rest of the console.
// Send-only: lead CRUD (create / status / delete) is done by the console
// directly against the open+validated outreach_leads collection.
const { Resend } = require('resend');
const { buildEmail } = require('../../functions/lib/templates');

const EMAIL_FROM = 'FluxyOS <hello@fluxyos.com>';
const REPLY_TO = 'hello@fluxyos.com';
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://fluxyos.com';
const ALLOWED = ['https://fluxyos.com', 'https://dashboard.fluxyos.com', 'https://www.fluxyos.com', 'http://localhost:8000', 'http://127.0.0.1:5500', 'http://127.0.0.1:8765'];

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    const cors = {
        'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : 'https://fluxyos.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-internal-token',
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method not allowed' };

    try {
        // --- Internal token gate ---
        const expected = process.env.INTERNAL_API_TOKEN;
        const got = (event.headers && (event.headers['x-internal-token'] || event.headers['X-Internal-Token'])) || '';
        if (!expected) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'token_not_configured' }) };
        if (got !== expected) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'unauthorized' }) };

        // --- Validate the lead payload ---
        let body = {};
        try { body = JSON.parse(event.body || '{}'); } catch (_) { body = {}; }
        const name = str(body.name, 120);
        const gender = ['male', 'female'].includes(body.gender) ? body.gender : 'male';
        const email = str(body.email, 200);
        const meetingISO = str(body.meetingISO, 40);
        const senderName = str(body.senderName, 120) || 'Tim FluxyOS';
        const meetingDt = meetingISO ? new Date(meetingISO) : null;
        if (!name || !email || !isEmail(email)) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_input' }) };
        if (!meetingDt || isNaN(meetingDt.getTime())) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_meeting' }) };

        if (!process.env.RESEND_API_KEY) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'email_not_configured' }) };

        const { subject, html, text } = buildEmail('lead_outreach', 'id', { name, gender, meetingISO, senderName, baseUrl: APP_BASE_URL });

        const resend = new Resend(process.env.RESEND_API_KEY);
        const res = await resend.emails.send({ from: EMAIL_FROM, to: email, reply_to: REPLY_TO, subject, html, text });
        if (res && res.error) throw new Error(res.error.message || 'Resend send error');

        return { statusCode: 200, headers: cors, body: JSON.stringify({ result: 'sent', id: (res && res.data && res.data.id) || null }) };
    } catch (e) {
        console.error('[send-lead-outreach] failed:', e && e.message ? e.message : e);
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: String(e && e.message ? e.message : 'server_error').slice(0, 160) }) };
    }
};
