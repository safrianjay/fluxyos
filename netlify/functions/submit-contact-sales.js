'use strict';

const { ALLOWED_ORIGINS } = require('./lib/allowed-origins');
const validation = require('../../assets/js/lead-form-validation');
const security = require('./lib/contact-sales-security');
const { consume, ipKey, clientIp } = require('./lib/rate-limit');
const crypto = require('crypto');

// Public "Contact Sales" lead intake. The marketing /contact-sales form POSTs
// here; validated leads pass honeypot, durable quotas, Turnstile and content
// checks before we write a sales_leads/{id} doc via
// the Admin SDK so the lead appears in the Internal Operations Console
// (Sales Leads tab). There is NO Firebase Auth on this endpoint (the visitor
// is anonymous), so the Admin SDK is the ONLY writer — firestore.rules deny all
// client writes to sales_leads. The public API itself must still reject spam.
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
        ...(lead.spamFlags && lead.spamFlags.length ? [`Review signals: ${lead.spamFlags.join(', ')}`] : []),
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
                body: JSON.stringify({ text: `:briefcase: *New Enterprise lead*\n${lines.map(l=>l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')).join('\n')}\n<${APP_BASE_URL}/internal|Open Sales Leads>`, unfurl_links:false, unfurl_media:false }),
            });
        } catch (e) { console.error('[contact-sales] slack alert failed:', e && e.message ? e.message : e); }
    }
}

const ALLOWED = ALLOWED_ORIGINS;
exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    const cors = {
        'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : 'https://fluxyos.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Vary': 'Origin',
    };
    const reply=(statusCode,error,field,headers={})=>({statusCode,headers:{...cors,...headers},body:JSON.stringify({error,...(field?{field}:{}),message:validation.message(error,'en')})});
    if(origin && !ALLOWED.includes(origin)) return reply(403,'submission_rejected');
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
    if (event.httpMethod !== 'POST') return reply(405,'method_not_allowed');

    // Accept JSON (the page's fetch) or urlencoded (native form fallback).
    let data;
    try {
        const headers=event.headers || {};
        const raw=event.isBase64Encoded?Buffer.from(event.body || '', 'base64').toString('utf8'):event.body || '';
        if(Buffer.byteLength(raw,'utf8')>16384) return reply(413,'invalid_input');
        const ct=(headers['content-type'] || headers['Content-Type'] || '').split(';')[0].trim().toLowerCase();
        if(ct==='application/json') data=JSON.parse(raw);
        else if(ct==='application/x-www-form-urlencoded'){
            const pairs=[...new URLSearchParams(raw)];
            if(new Set(pairs.map(([key])=>key)).size!==pairs.length) return reply(400,'invalid_input');
            data=Object.fromEntries(pairs);
        } else return reply(415,'invalid_input');
        if(!data || typeof data!=='object' || Array.isArray(data)) return reply(400,'invalid_input');
    } catch (_) { return reply(400,'invalid_input'); }

    // Honeypot: bots fill bot-field. Return 200 so they don't retry, but never
    // write the lead.
    if(data['bot-field']!==undefined && data['bot-field']!=='') return {statusCode:200,headers:cors,body:JSON.stringify({ok:true})};
    const checked=validation.validate(data);
    if(!checked.ok) return reply(400,checked.error,checked.field);
    const {name,email,whatsapp,company,business_type:businessType,team_size:teamSize,message,source}=checked.lead;
    // Event walk-ups are not enterprise leads by default; they self-select.
    const planInterest = source === 'event-signup' ? 'event' : 'enterprise';

    const config=security.policy();
    if(!config) return reply(503,'verification_unavailable');
    const session=security.readSession(data.form_session,config.signingSecret);
    if(!session) return reply(403,'verification_failed');
    if(config.mode==='turnstile' && (typeof data['cf-turnstile-response']!=='string' || !data['cf-turnstile-response'] || data['cf-turnstile-response'].length>2048)) return reply(403,'verification_failed');

    try {
        const db = initAdmin();
        const ip=clientIp(event.headers || {});
        const configuredLimit=Number(process.env.CONTACT_FORM_IP_LIMIT || 10);
        const ipLimit=Number.isInteger(configuredLimit) && configuredLimit>=1 && configuredLimit<=1000?configuredLimit:10;
        // Shared durable buckets: changing source or rotating sessions cannot
        // bypass quotas. Limiter outages fail CLOSED for this write endpoint.
        const ipQuota=await consume(db,{key:ipKey(clientIp(event.headers || {}), 'sales'),limit:ipLimit,windowSeconds:600});
        if(ipQuota.degraded) return reply(503,'verification_unavailable');
        if(!ipQuota.allowed) return reply(429,'rate_limited',null,{'Retry-After':String(ipQuota.retryAfter)});
        const emailKey='sales_email_'+crypto.createHmac('sha256',config.signingSecret).update(email).digest('hex').slice(0,32);
        const emailQuota=await consume(db,{key:emailKey,limit:3,windowSeconds:3600});
        if(emailQuota.degraded) return reply(503,'verification_unavailable');
        if(!emailQuota.allowed) return reply(429,'rate_limited',null,{'Retry-After':String(emailQuota.retryAfter)});
        if(config.mode==='turnstile') {
            const verified=await security.verifyToken(data['cf-turnstile-response'],ip,session,config.turnstile);
            if(!verified.ok) return reply(verified.error==='verification_unavailable'?503:403,verified.error);
        }
        const elapsedMs=Math.max(0,Date.now()-session.iat);
        const risk=security.assessContent(checked.lead,elapsedMs);
        if(risk.reject) return reply(400,'submission_rejected');
        const clientDuration=data.completion_ms;
        if(clientDuration!==undefined && (!Number.isSafeInteger(clientDuration) || clientDuration<0 || clientDuration>security.SESSION_MAX_MS)) return reply(400,'invalid_input');
        const ref = await db.collection('sales_leads').add({
            name,
            email,
            whatsapp,
            company,
            business_type: businessType,
            team_size: teamSize || null,
            message: message || null,
            status: 'new',
            source,
            plan_interest: planInterest,
            user_agent: String((event.headers || {})['user-agent'] || (event.headers || {})['User-Agent'] || '').replace(/[<>\u0000-\u001F\u007F]/g,'').slice(0,400) || null,
            bot_verification:config.mode==='turnstile'?'turnstile':'pending',
            form_issued_at:new Date(session.iat),
            form_duration_ms:elapsedMs,
            client_completion_ms:clientDuration===undefined?null:clientDuration,
            spam_flags:risk.flags,
            spam_score:risk.score,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Fire alerts after the lead is safely stored (best-effort, never throws).
        await notifyNewLead({ name, email, whatsapp, company, business_type: businessType, team_size: teamSize, message, spamFlags:risk.flags }).catch(() => {});
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, id: ref.id }) };
    } catch (err) {
        console.error('[contact-sales] lead write failed:', err && err.message ? err.message : err);
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'server_error' }) };
    }
};
