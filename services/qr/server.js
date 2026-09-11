'use strict';

// =============================================================================
// FluxyOS — the five QR diner functions on Cloud Run, in asia-southeast1.
//
// WHY (docs/perf/LOAD_2026-09-11.md). On Netlify these ran in us-east-2 against
// a Firestore in Singapore: ~200 ms per database round trip, ~0.3 s of edge-to-
// Ohio on every request, and a cold start of 4–12 s whenever an instance had
// idled 2.5–4 minutes. Moving the region needs a paid Netlify plan; keeping
// them warm by pinging cost a third of the Free plan's invocations and still
// missed a quarter to half of first diners. Here they sit beside the database,
// one instance never goes away (`--min-instances 1`), and one instance serves
// many requests at once — a menu's burst of photos no longer starts a fresh,
// cold instance per photo.
//
// THE SAME CODE. This file adapts a Node request into the event a Netlify
// function receives and calls the SAME handlers (netlify/functions/qr-*.js),
// copied in unchanged by scripts/build-qr-service.js. There is no second
// implementation of pricing, sittings, idempotency or the limiter to drift.
// The Netlify copies stay deployed: switching `QR_API` in order.html back is
// the rollback.
//
// CREDENTIALS: the service's own account (qr-diner@), through the metadata
// server. The admin app is initialised HERE, before any handler loads, so each
// handler's initAdmin() finds it and never looks for FIREBASE_SERVICE_ACCOUNT.
// Signed photo URLs are signed through IAM (signBlob) as that account.
// =============================================================================

const http = require('http');
const admin = require('firebase-admin');

admin.initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'fluxyos',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'fluxyos.firebasestorage.app'
});

const ROUTES = {
    'qr-menu': require('./netlify/functions/qr-menu.js').handler,
    'qr-menu-image': require('./netlify/functions/qr-menu-image.js').handler,
    'qr-order': require('./netlify/functions/qr-order.js').handler,
    'qr-order-status': require('./netlify/functions/qr-order-status.js').handler,
    'qr-request-bill': require('./netlify/functions/qr-request-bill.js').handler
};

// A diner's order is a few KB; nothing a phone sends here is legitimately larger.
const MAX_BODY = 64 * 1024;

/**
 * ⚠️ THE RATE LIMITER'S IP, AND WHY IT IS THE LAST ENTRY.
 *
 * The handlers key their per-IP limits on `x-nf-client-connection-ip`, which
 * on Netlify is set by Netlify and cannot be forged. Here, Google's front end
 * APPENDS the address that connected to it to `X-Forwarded-For`; anything
 * before that entry was supplied by the client. Taking the first entry — the
 * handlers' fallback — would let anyone pick a fresh bucket per request by
 * sending a made-up header. So the last entry is used, and whatever the client
 * sent as `x-nf-client-connection-ip` is replaced, never trusted.
 */
function clientIp(req) {
    const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
    return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function send(res, statusCode, headers, body) {
    res.writeHead(statusCode, headers);
    res.end(body || '');
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // `/health`, not `/healthz`: Cloud Run's front end reserves paths ending in
    // `z` and answers them itself with a 404 — the request never arrives here.
    if (url.pathname === '/health') return send(res, 200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }, 'ok');

    // `/qr-menu` and `/.netlify/functions/qr-menu` both work, so a page can
    // point its base at either host without changing a single path.
    const name = url.pathname.replace(/^\/(\.netlify\/functions\/)?/, '').replace(/\/+$/, '');
    const handler = ROUTES[name];
    if (!handler) {
        return send(res, 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, '{"error":"not_found"}');
    }

    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { tooBig = true; return; }
        chunks.push(c);
    });
    req.on('end', async () => {
        if (tooBig) return send(res, 413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, '{"error":"too_large"}');
        const headers = { ...req.headers };
        headers['x-nf-client-connection-ip'] = clientIp(req);
        const event = {
            httpMethod: req.method,
            headers,
            queryStringParameters: Object.fromEntries(url.searchParams),
            body: chunks.length ? Buffer.concat(chunks).toString('utf8') : null,
            isBase64Encoded: false,
            path: url.pathname,
            rawUrl: url.toString()
        };
        let out;
        try {
            out = await handler(event);
        } catch (err) {
            console.error(`[qr-service] ${name} threw`, err && err.message);
            out = { statusCode: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: '{"error":"server_error"}' };
        }
        const outHeaders = { ...(out.headers || {}) };
        // The diner page calls this origin from order.fluxyos.com, so every
        // order and bill request is preceded by a CORS preflight. Let the
        // browser keep the answer for two hours (Chrome's ceiling) instead of
        // asking again before every tap.
        if (req.method === 'OPTIONS' && (out.statusCode === 204 || out.statusCode === 200)) {
            outHeaders['Access-Control-Max-Age'] = '7200';
        }
        send(res, out.statusCode || 200, outHeaders, out.body);
    });
    req.on('error', () => { /* the client went away; nothing to answer */ });
});

// Cloud Run asks politely before it stops an instance; finish what is in flight.
process.on('SIGTERM', () => server.close(() => process.exit(0)));

const PORT = Number(process.env.PORT || 8080);
server.listen(PORT, () => console.log(`[qr-service] listening on ${PORT}`));

module.exports = { clientIp, ROUTES };
