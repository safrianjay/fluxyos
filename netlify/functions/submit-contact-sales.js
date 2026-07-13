'use strict';

// Public "Contact Sales" lead intake. The marketing /contact-sales form POSTs
// here; we honeypot-filter + validate, then write a sales_leads/{id} doc via
// the Admin SDK so the lead appears in the Internal Operations Console
// (Sales Leads tab). There is NO Firebase Auth on this endpoint (the visitor
// is anonymous), so the Admin SDK is the ONLY writer — firestore.rules deny all
// client writes to sales_leads, which keeps the public collection spam-proof.
const admin = require('firebase-admin');
const { initAdmin } = require('./lib/notify-core');
const { Resend } = require('resend');

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://fluxyos.com';
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Best-effort new-lead alerts. Each channel is independent and gated by its own
// env vars; a missing config is a silent skip and a send failure never affects
// the lead write or the HTTP response.
async function notifyNewLead(lead) {
    const lines = [
        `Name: ${lead.name}`,
        `Email: ${lead.email}`,
        `WhatsApp: ${lead.whatsapp || '—'}`,
        `Company: ${lead.company}`,
        `Business type: ${lead.business_type || '—'}`,
        `Team size: ${lead.team_size || '—'}`,
        `Message: ${lead.message || '—'}`,
    ];

    // 1) Email via Resend (to SALES_ALERT_EMAIL).
    const alertEmail = process.env.SALES_ALERT_EMAIL;
    if (alertEmail && process.env.RESEND_API_KEY) {
        try {
            const resend = new Resend(process.env.RESEND_API_KEY);
            await resend.emails.send({
                from: process.env.EMAIL_FROM || 'FluxyOS <notifications@fluxyos.com>',
                to: alertEmail,
                reply_to: lead.email,
                subject: `New Enterprise lead — ${lead.company}`,
                html: `<h2 style="margin:0 0 12px">New Contact Sales lead</h2>
                    <p style="margin:0 0 16px;color:#374151">${lines.map((l) => escapeHtml(l)).join('<br>')}</p>
                    <a href="${APP_BASE_URL}/internal" style="display:inline-block;background:#0B0F19;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Open Sales Leads</a>`,
            });
        } catch (e) { console.error('[contact-sales] email alert failed:', e && e.message ? e.message : e); }
    }

    // 2) Slack (to SLACK_WEBHOOK_URL).
    if (process.env.SLACK_WEBHOOK_URL) {
        try {
            await fetch(process.env.SLACK_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: `:briefcase: *New Enterprise lead*\n${lines.join('\n')}\n<${APP_BASE_URL}/internal|Open Sales Leads>` }),
            });
        } catch (e) { console.error('[contact-sales] slack alert failed:', e && e.message ? e.message : e); }
    }
}

const ALLOWED = [
    'https://fluxyos.com', 'https://dashboard.fluxyos.com', 'https://www.fluxyos.com',
    'http://localhost:8000', 'http://127.0.0.1:5500', 'http://127.0.0.1:8765',
];
const TEAM_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'];
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    const cors = {
        'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : 'https://fluxyos.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method not allowed' };

    // Accept JSON (the page's fetch) or urlencoded (native form fallback).
    let data = {};
    try {
        const ct = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
        data = ct.includes('application/json')
            ? JSON.parse(event.body || '{}')
            : Object.fromEntries(new URLSearchParams(event.body || ''));
    } catch (_) { data = {}; }

    // Honeypot: bots fill bot-field. Return 200 so they don't retry, but never
    // write the lead.
    if (str(data['bot-field'], 200)) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };

    const name = str(data.name, 120);
    const email = str(data.email, 200);
    const whatsapp = str(data.whatsapp, 40);
    const company = str(data.company, 160);
    const businessType = str(data.business_type, 60);
    const teamSize = TEAM_SIZES.includes(data.team_size) ? data.team_size : '';
    const message = str(data.message, 2000);

    const whatsappDigits = (whatsapp.match(/\d/g) || []).length;
    if (!name || !email || !isEmail(email) || !whatsapp || whatsappDigits < 6 || !company || !businessType) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_input' }) };
    }

    try {
        const db = initAdmin();
        const ref = await db.collection('sales_leads').add({
            name,
            email,
            whatsapp,
            company,
            business_type: businessType,
            team_size: teamSize || null,
            message: message || null,
            status: 'new',
            source: 'contact-sales',
            plan_interest: 'enterprise',
            user_agent: str(event.headers['user-agent'] || event.headers['User-Agent'], 400) || null,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Fire alerts after the lead is safely stored (best-effort, never throws).
        await notifyNewLead({ name, email, whatsapp, company, business_type: businessType, team_size: teamSize, message }).catch(() => {});
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, id: ref.id }) };
    } catch (err) {
        console.error('[contact-sales] lead write failed:', err && err.message ? err.message : err);
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'server_error' }) };
    }
};
