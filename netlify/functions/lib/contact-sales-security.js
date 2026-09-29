'use strict';
const crypto = require('crypto');
const { PRODUCTION_ORIGINS } = require('./allowed-origins');
const SESSION_MAX_MS = 2 * 60 * 60 * 1000;
const ACTION = 'sales_lead';
function configuration() {
    const siteKey=process.env.TURNSTILE_SITE_KEY || '';
    const secret=process.env.TURNSTILE_SECRET_KEY || '';
    // Reject Cloudflare testing keys on deployed production; no test bypass.
    if(!siteKey || !secret || (process.env.CONTEXT==='production' && /^[123]x0{10}/.test(siteKey))) return null;
    return {siteKey,secret};
}
function policy() {
    const turnstile = configuration();
    const signingSecret = process.env.CONTACT_FORM_SESSION_SECRET || (turnstile && turnstile.secret);
    if (turnstile && signingSecret) return { mode: 'turnstile', signingSecret, turnstile };
    // Pending is an explicit SERVER configuration, never a browser override or
    // an automatic fallback on outages. Partial/invalid widget config fails closed.
    if (process.env.CONTACT_FORM_BOT_MODE === 'pending' && signingSecret && signingSecret.length >= 32 &&
        !process.env.TURNSTILE_SITE_KEY && !process.env.TURNSTILE_SECRET_KEY) {
        return { mode: 'pending', signingSecret, turnstile: null };
    }
    return null;
}
function signingKey(secret) { return crypto.createHmac('sha256',secret).update('fluxyos-contact-form-session-v1').digest(); }
function issueSession(secret, now=Date.now()) {
    const nonce=crypto.randomBytes(16).toString('hex');
    const payload=Buffer.from(JSON.stringify({iat:now,nonce})).toString('base64url');
    const signature=crypto.createHmac('sha256',signingKey(secret)).update(payload).digest('base64url');
    return {session:payload+'.'+signature,nonce,issuedAt:now};
}
function readSession(token, secret, now=Date.now()) {
    if(typeof token!=='string' || token.length>512) return null;
    const parts=token.split('.');if(parts.length!==2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
    const signature=Buffer.from(parts[1],'base64url');
    const expected=crypto.createHmac('sha256',signingKey(secret)).update(parts[0]).digest();
    if(signature.length!==expected.length || !crypto.timingSafeEqual(signature,expected)) return null;
    try {
        const session=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
        if(!Number.isSafeInteger(session.iat) || session.iat>now+1000 || now-session.iat>SESSION_MAX_MS || !/^[a-f0-9]{32}$/.test(session.nonce)) return null;
        return session;
    } catch (_) { return null; }
}
function allowedHosts() {
    const hosts=process.env.TURNSTILE_ALLOWED_HOSTNAMES;
    return hosts ? hosts.split(',').map(h=>h.trim().toLowerCase()).filter(h=>/^[a-z0-9.-]+$/.test(h)) : PRODUCTION_ORIGINS.filter(o=>new URL(o).hostname==='fluxyos.com' || new URL(o).hostname==='www.fluxyos.com').map(o=>new URL(o).hostname);
}
async function verifyToken(token, ip, session, config, fetchImpl=fetch) {
    if(typeof token!=='string' || !token || token.length>2048) return {ok:false,error:'verification_failed'};
    try {
        const response=await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
            method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(8000),
            body:JSON.stringify({secret:config.secret,response:token,...(ip==='unknown'?{}:{remoteip:ip})})
        });
        if(!response.ok) return {ok:false,error:'verification_unavailable'};
        const result=await response.json();
        if(!result || result.success!==true) return {ok:false,error:result && (result['error-codes']||[]).some(c=>['internal-error','invalid-input-secret','missing-input-secret'].includes(c))?'verification_unavailable':'verification_failed'};
        if(result.action!==ACTION || result.cdata!==session.nonce || !allowedHosts().includes(String(result.hostname || '').toLowerCase())) return {ok:false,error:'verification_failed'};
        return {ok:true,hostname:result.hostname};
    } catch (_) { return {ok:false,error:'verification_unavailable'}; }
}
function assessContent(lead, elapsedMs) {
    const flags=[];let score=0;let reject=false;
    const text=[lead.name,lead.company,lead.business_type,lead.message].join(' ');
    const urls=text.match(/\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/gi)||[];
    if(urls.length>=3){flags.push('excessive_urls');reject=true;}
    else if(urls.length){flags.push('contains_url');score+=1;}
    if(/(.)\1{9,}|(.{3,16})\2{3,}/iu.test(text) || /(\b[\p{L}\p{N}]{2,}\b)(?:\s+\1){3,}/iu.test(text)){flags.push('repeated_content');reject=true;}
    if(/\b(?:buy\s+backlinks|guest\s+posts?\s+(?:service|offer)|casino\s+bonus|viagra|adult\s+dating|guaranteed\s+(?:investment\s+)?returns)\b/i.test(text)){flags.push('spam_pattern');score+=2;}
    // A mixed-case, digit-heavy opaque token is a signal, not a ban on jargon.
    if((text.match(/\b[A-Za-z0-9]{24,}\b/g)||[]).some(s=>(s.match(/[a-z]/g)||[]).length>=4 && (s.match(/[A-Z]/g)||[]).length>=4 && (s.match(/[0-9]/g)||[]).length>=4)){flags.push('opaque_content');score+=2;}
    if(elapsedMs<2000){flags.push('fast_completion');score+=1;}
    return {flags,score,reject:reject || score>=3};
}
module.exports={configuration,policy,issueSession,readSession,verifyToken,assessContent,ACTION,SESSION_MAX_MS};
