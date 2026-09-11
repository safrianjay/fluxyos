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
// THE COLLECTION WOULD GROW: each key/window pair is its own document. A
// Firestore TTL policy on `rate_limits.expires_at` deletes them within about a
// day of expiry — declared in firestore.indexes.json (fieldOverrides, `ttl`)
// and ACTIVE since 2026-09-11. Every write here must keep setting
// `expires_at`, or its document is never collected.
// =============================================================================

const crypto = require('crypto');
// The static namespace only — no app, no credentials, nothing initialised. It
// is here for `FieldValue.increment`, which is what lets consumeApprox() bump a
// counter without reading it back under a lock.
const { firestore } = require('firebase-admin');
const FieldValue = firestore.FieldValue;

/**
 * An IP is personal data and a rate-limit key does not need to be reversible.
 * Hashed with a salt so the collection cannot be mined for who visited which
 * restaurant, and truncated because 128 bits of a SHA-256 is far past collision
 * concerns for a counter.
 *
 * ⚠️ ONE BUCKET PER ENDPOINT — `scope` IS REQUIRED. Until 2026-09-11 every QR
 * endpoint called `ipKey(ip)` and so shared ONE document per IP per minute,
 * while each compared that shared count with its OWN limit: photos 300, status
 * 90, menu 60, order 20, bill 20. A diner scrolling the menu spent the order
 * allowance on photos, and their order came back 429. Reproduced in 4 of 4
 * load-test baselines at zero load, and found in production history — 8
 * IP-minutes over 20 between 7 and 9 Sep (docs/perf/S1_BASELINE_2026-09-11.md,
 * F1). A limit only means what it says when the counter holds only the
 * requests it limits, so the endpoint is part of the key and cannot be left
 * out: a call without one throws instead of quietly sharing a bucket.
 */
const SCOPE = /^[a-z][a-z0-9]{0,15}$/;

function ipKey(ip, scope) {
    if (!SCOPE.test(String(scope || ''))) {
        throw new Error(`ipKey needs an endpoint scope (got ${JSON.stringify(scope)})`);
    }
    const salt = process.env.RATE_LIMIT_SALT || 'fluxyos-rate-limit';
    return `ip_${scope}_` + crypto.createHash('sha256').update(salt + '|' + String(ip || 'unknown'))
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

/**
 * The 429 body and headers, so every endpoint refuses identically.
 *
 * JSON, like every other refusal these endpoints make. It was the plain text
 * "Too many requests", which `order.html` fed to `r.json()` — the parse threw,
 * and the diner was told "Could not send your order" with no hint that waiting
 * a few seconds was the whole fix. `retry_after` is in the body as well as the
 * header so the page never depends on reading a response header.
 */
function tooManyRequests(result, extraHeaders = {}) {
    const retryAfter = Math.max(1, result.retryAfter || 1);
    return {
        statusCode: 429,
        headers: {
            ...extraHeaders,
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
            'Cache-Control': 'no-store'
        },
        body: JSON.stringify({ error: 'rate_limited', retry_after: retryAfter })
    };
}

/**
 * The same cap, without the transaction.
 *
 * ⚠️ WHY THIS EXISTS: `consume` is a read-modify-write TRANSACTION on ONE
 * document, and a single QR menu fires ~15-20 image requests at once. Every one
 * of them transacts on the same `ip_<hash>__<window>` doc and the same
 * `tok_<token>__<day>` doc, so they contend, retry, and serialise — the limiter
 * becomes the slowest part of loading a photograph, and it gets worse the more
 * photographs a menu has.
 *
 * This reads the counter without a lock and increments it blind, so concurrent
 * callers never queue behind each other. The write is not awaited: nothing in
 * the response depends on it, and making the diner wait for a counter to land
 * is the cost this function exists to avoid.
 *
 * ⚠️ IT COUNTS APPROXIMATELY, AND THAT IS THE TRADE. Requests in flight
 * together read the same value, so a burst can overshoot the limit by roughly
 * its own size before the count catches up.
 *
 * ⚠️ EVERY QR ENDPOINT USES THIS NOW, ORDERS AND BILLS INCLUDED (2026-09-11).
 * This note used to say an order or a bill must keep `consume`. The load test
 * measured what that cost: four phones at one table ordering in the same
 * second queued on the same limiter document, and `qr-order` took 8.2 s at
 * p95 with nobody else on the system (docs/perf/S1_BASELINE_2026-09-11.md,
 * F4). The limiter was never what kept an order correct — the order's own
 * transaction and the `qr_order_refs` idempotency record do that. What the
 * limiter guards is VOLUME (spam, enumeration, cost), and for volume an
 * overshoot the size of one table's simultaneous taps is not a harm.
 * `consume` remains for any future caller that genuinely needs an exact count.
 */
async function consumeApprox(db, { key, limit, windowSeconds }) {
    const now = Date.now();
    const windowMs = Math.max(1, Number(windowSeconds) || 60) * 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const id = `${String(key).replace(/[^A-Za-z0-9_-]/g, '')}__${windowStart}`;
    const ref = db.collection('rate_limits').doc(id);

    try {
        const snap = await ref.get();
        const count = snap.exists ? (Number(snap.data().count) || 0) : 0;
        if (count >= limit) {
            return {
                allowed: false,
                count,
                limit,
                retryAfter: Math.ceil((windowStart + windowMs - now) / 1000)
            };
        }
        // Fire and forget. A dropped increment under-counts by one, which is the
        // same shape of inaccuracy this function already accepts.
        ref.set({
            count: FieldValue.increment(1),
            key: String(key).slice(0, 200),
            window_start: new Date(windowStart),
            expires_at: new Date(windowStart + windowMs * 2)
        }, { merge: true }).catch((err) => {
            console.error('[rate-limit] increment dropped:', err && err.message);
        });
        return { allowed: true, count: count + 1, limit, retryAfter: 0 };
    } catch (err) {
        console.error('[rate-limit] failing open:', err && err.message);
        return { allowed: true, count: 0, limit, retryAfter: 0, degraded: true };
    }
}

module.exports = { consume, consumeApprox, ipKey, clientIp, tooManyRequests };
