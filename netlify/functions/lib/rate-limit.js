'use strict';

// =============================================================================
// FluxyOS — rate limiting for public endpoints
//
// WHY THIS EXISTS. `POS_IMPLEMENTATION_PLAN.md` §18.10: *"grep across netlify/
// returns nothing for rate limiting. Today that is acceptable because every
// write path is authenticated. A public order endpoint changes that."* It calls
// per-token, per-IP and per-workspace caps a **Phase 2 blocker, not a
// follow-up**.
//
// The premise it rested on has already shifted: `qr-menu-image.js` is a public
// READ endpoint, so "every path is authenticated" stopped being true before the
// order endpoint was written.
//
// WHAT STORE. Netlify Functions are stateless and a per-instance counter is
// theatre — each invocation may be a fresh container, so an in-memory limiter
// answers "0 so far" to an attacker as fast as they can open connections.
// `@netlify/blobs` is not installed. `firebase-admin` is, and every function
// here already holds a Firestore handle, so Firestore is the durable store
// actually available.
//
// FIXED WINDOW, NOT A TOKEN BUCKET. A bucket needs the elapsed time since the
// last request, which means storing and reading a timestamp and doing float
// arithmetic on a shared document. A fixed window is one integer and one
// transaction, and its known weakness — up to 2x the limit across a window
// boundary — does not matter for caps whose purpose is to stop enumeration and
// cost attacks rather than to shape traffic precisely.
//
// COST IS THE REASON THE CALLER CHOOSES THE DIMENSIONS. Each dimension is one
// Firestore transaction: a read and a write. Checking token + IP + workspace on
// every menu photo would triple the cost of the cheapest request in the product.
// So this exports a primitive and each endpoint decides what it can afford —
// see the note in `qr-menu-image.js` for why an image checks one dimension and
// an order write should check three.
//
// ⚠️ `rate_limits` needs no firestore.rules block. The ruleset ends with
// `match /{document=**} { allow read, write: if false; }`, so a new top-level
// collection is denied to every client by default and only the Admin SDK can
// touch it. Adding an explicit block would be the same statement twice.
//
// ⚠️ THE COLLECTION GROWS. Each key/window pair is its own document and nothing
// deletes them. Set a Firestore TTL policy on `expires_at` (a project setting,
// not a rules change) before this carries real traffic, or the collection
// accumulates one document per key per window forever.
// =============================================================================

const crypto = require('crypto');

/**
 * An IP is personal data and a rate-limit key does not need to be reversible.
 * Hashed with a salt so the collection cannot be mined for who visited which
 * restaurant, and truncated because 128 bits of a SHA-256 is far past collision
 * concerns for a counter.
 */
function ipKey(ip) {
    const salt = process.env.RATE_LIMIT_SALT || 'fluxyos-rate-limit';
    return 'ip_' + crypto.createHash('sha256').update(salt + '|' + String(ip || 'unknown'))
        .digest('hex').slice(0, 32);
}

/**
 * The caller's IP, from the headers Netlify actually sets. `x-nf-client-connection-ip`
 * is the one Netlify guarantees; `x-forwarded-for` may carry a proxy chain, so
 * only its FIRST entry is the client and the rest are hops that must not be
 * trusted or keyed on.
 */
function clientIp(headers = {}) {
    const h = (name) => headers[name] || headers[name.toLowerCase()] || '';
    const direct = h('x-nf-client-connection-ip');
    if (direct) return String(direct).trim();
    const fwd = String(h('x-forwarded-for') || '').split(',')[0].trim();
    return fwd || 'unknown';
}

/**
 * Consume one unit against `key` within a fixed window.
 *
 * @returns {{allowed:boolean, count:number, limit:number, retryAfter:number}}
 *
 * FAILS OPEN. If Firestore is unreachable the request is ALLOWED, and that is
 * deliberate: this protects against cost and noise, not against a breach. A
 * limiter that fails closed converts a database blip into a restaurant whose
 * customers cannot see the menu, which is a worse outcome than a minute of
 * unthrottled reads. Every failure is logged so it is visible rather than
 * assumed.
 */
async function consume(db, { key, limit, windowSeconds }) {
    const now = Date.now();
    const windowMs = Math.max(1, Number(windowSeconds) || 60) * 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    // The window is IN the document id, so a new window is a new document and
    // there is nothing to reset. Two requests either side of a boundary cannot
    // race over the same counter.
    const id = `${String(key).replace(/[^A-Za-z0-9_-]/g, '')}__${windowStart}`;
    const ref = db.collection('rate_limits').doc(id);

    try {
        return await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const count = snap.exists ? (Number(snap.data().count) || 0) : 0;
            if (count >= limit) {
                return {
                    allowed: false,
                    count,
                    limit,
                    retryAfter: Math.ceil((windowStart + windowMs - now) / 1000)
                };
            }
            tx.set(ref, {
                count: count + 1,
                key: String(key).slice(0, 200),
                window_start: new Date(windowStart),
                // What a Firestore TTL policy would read. Nothing enforces it
                // until that policy is configured — see the header note.
                expires_at: new Date(windowStart + windowMs * 2)
            }, { merge: true });
            return { allowed: true, count: count + 1, limit, retryAfter: 0 };
        });
    } catch (err) {
        console.error('[rate-limit] failing open:', err && err.message);
        return { allowed: true, count: 0, limit, retryAfter: 0, degraded: true };
    }
}

/** The 429 body and headers, so every endpoint refuses identically. */
function tooManyRequests(result, extraHeaders = {}) {
    return {
        statusCode: 429,
        headers: {
            ...extraHeaders,
            'Retry-After': String(Math.max(1, result.retryAfter || 1)),
            'Cache-Control': 'no-store'
        },
        body: 'Too many requests'
    };
}

module.exports = { consume, ipKey, clientIp, tooManyRequests };
