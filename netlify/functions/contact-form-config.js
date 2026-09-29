'use strict';
const { ALLOWED_ORIGINS } = require('./lib/allowed-origins');
const { policy, issueSession, ACTION } = require('./lib/contact-sales-security');
exports.handler=async event=>{
    const origin=(event.headers||{}).origin || (event.headers||{}).Origin || '';
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Origin':ALLOWED_ORIGINS.includes(origin)?origin:'https://fluxyos.com','Access-Control-Allow-Methods':'GET, OPTIONS'};
    if(origin && !ALLOWED_ORIGINS.includes(origin)) return {statusCode:403,headers,body:JSON.stringify({error:'submission_rejected'})};
    if(event.httpMethod==='OPTIONS') return {statusCode:204,headers};
    if(event.httpMethod!=='GET') return {statusCode:405,headers,body:JSON.stringify({error:'method_not_allowed'})};
    const config=policy();
    if(!config) return {statusCode:503,headers,body:JSON.stringify({error:'verification_unavailable'})};
    // Only the PUBLIC key and a signed, expiring form session leave the server.
    return {statusCode:200,headers,body:JSON.stringify({mode:config.mode,...(config.turnstile?{siteKey:config.turnstile.siteKey,action:ACTION}:{}),...issueSession(config.signingSecret)})};
};
