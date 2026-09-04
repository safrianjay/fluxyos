'use strict';

const { allowOriginHeader } = require('./lib/allowed-origins');
const { consume, ipKey, clientIp, tooManyRequests } = require('./lib/rate-limit');

// =============================================================================
// FluxyOS — menu photos for a QR customer, who is not signed in.
//
// THE PROBLEM THIS SOLVES, AND WHY THE OBVIOUS FIX IS WRONG.
//
// `items.image_path` holds a Storage PATH, never a URL. The till renders it by
// calling `getBlob()`, which sends the cashier's Firebase ID token so
// `storage.rules` can check workspace membership on every read. A QR customer
// has no account, is not a member, and never will be — that read is denied, so
// a customer menu built the same way shows no photos at all.
//
// The obvious fix is `getDownloadURL()`. It is off the table, permanently:
// Firebase serves those links over public HTTPS with Security Rules BYPASSED
// (proven in this codebase by fetching one with curl and getting HTTP 200), and
// the token is stamped at upload and cannot be removed by the client. One leaked
// link would expose that object to anyone, forever, with no way to revoke it
// short of deleting the file. `db-service.js` removed getDownloadURL from the
// document path for exactly this reason.
//
// The second obvious fix — a public-read prefix in storage.rules for menu photos
// — is worse than it looks. It makes every menu photo in every workspace on the
// platform world-readable by URL, including businesses that have not launched,
// and there is no per-table scoping in a Storage rule.
//
// SO: the customer never gets a URL to Storage. They get a URL to THIS, keyed by
// the table token from their QR code, and the server decides.
//
//     GET /.netlify/functions/qr-menu-image?token=<tableToken>&item=<itemId>
//
//   1. Resolve the token through `pos_table_directory` (Admin SDK; the
//      collection is deny-all to every client, so a guessed token cannot even
//      confirm a workspace exists).
//   2. Read the item IN THAT WORKSPACE and require `pos_visible === true`.
//      This is the scoping the Storage rule could never express: a token for
//      one restaurant cannot fetch another's photo, and an item that is not on
//      the menu has no image to serve even to the right table.
//   3. Mint a SHORT-LIVED signed URL and 302 to it.
//
// Redirecting rather than proxying the bytes is deliberate. A Netlify function
// streaming every image would put a serverless invocation on the critical path
// of every tile on a menu, and pay for the bytes twice. The signed URL is
// minutes-long, unguessable, and expires — the properties the permanent download
// token lacks.
//
// ⚠️ `pos_table_directory` is currently EMPTY. It has rules and a design and
// nothing writes it yet (see docs/CUSTOMER_ORDERING_PLAN_REVIEW.md §3). Whoever
// builds the QR entry point populates it; this function is written against the
// seam that already exists rather than inventing a second one.
// =============================================================================

const admin = require('firebase-admin');

// Long enough for a phone on a restaurant's wifi to load a menu and scroll it;
// short enough that a URL copied out of a network log is dead before it is
// useful. The customer never sees it — it lives one redirect deep.
const URL_TTL_MS = 15 * 60 * 1000;

// Browsers may cache the redirect target. Kept under the signed URL's own life
// so a cached response can never outlive the credential inside it.
const CACHE_SECONDS = 300;

// ── What this endpoint can afford to check ──────────────────────────────────
//
// Every rate-limit dimension is one Firestore transaction, and this is the
// cheapest request in the product — one per photo on a menu. Checking token, IP
// and workspace on each would triple the cost of loading a menu.
//
// So it checks ONE dimension: the table token, daily. A token is a physical
// table, and no table's menu is legitimately fetched thousands of times a day.
// That is the cap that stops a scanned QR being turned into a cost attack,
// which is the actual exposure here — the token is 256 bits and item ids are
// unguessable, so this endpoint leaks nothing without a code somebody scanned.
//
// An ORDER endpoint is the opposite shape — a handful of calls per sitting,
// each a write — and §18.10 requires all three dimensions there. Do not copy
// this endpoint's single check into one that writes.
const TOKEN_DAILY_LIMIT = 5000;
const DAY_SECONDS = 24 * 60 * 60;
// A second, much shorter window on the IP. A menu is ~30 photos and a browser
// re-requests on navigation, so this has to sit well above a real page load
// while still stopping a loop. Keyed on the hash, never the address itself.
const IP_BURST_LIMIT = 300;
const IP_BURST_SECONDS = 60;

let _initialized = false;
function initAdmin() {
    if (!_initialized) {
        if (!admin.apps.length) {
            const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
            if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
            admin.initializeApp({
                credential: admin.credential.cert(JSON.parse(raw)),
                storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'fluxyos.firebasestorage.app',
            });
        }
        _initialized = true;
    }
    return admin;
}

// Token and item id are the only two inputs and both are attacker-controlled.
// Bounded and character-restricted before they reach a document path, because a
// path segment containing `/` or `..` is how one becomes a different read.
const SAFE = /^[A-Za-z0-9_-]{1,128}$/;

exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    // This endpoint returns an IMAGE to a page that may sit on an origin the
    // allowlist does not know yet (the customer surface has no role or domain
    // of its own — REVIEW §2.4). An <img src> is not a CORS request, so the
    // header is a courtesy for anything that does fetch it, and it still never
    // widens to `*`.
    const cors = {
        'Access-Control-Allow-Origin': allowOriginHeader(origin),
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers: cors, body: 'Method not allowed' };
    }

    const q = event.queryStringParameters || {};
    const token = String(q.token || '');
    const itemId = String(q.item || '');
    // `?cover=1` asks for the OUTLET's header photo instead of an item's. Served
    // by this endpoint rather than as a URL in the qr-menu payload, so it gets
    // the same three gates every menu photo does — the rate limiter, the revoked
    // token check, and a path guard — and so there stays ONE way a diner's phone
    // reaches Storage.
    const wantsCover = String(q.cover || '') === '1';

    // One shape of refusal for every failure below. A customer holding a valid
    // token for table 4 must not be able to learn, from the difference between
    // two error messages, whether an item id exists in someone else's workspace.
    const notFound = { statusCode: 404, headers: { ...cors, 'Cache-Control': 'no-store' }, body: 'Not found' };

    // An item id is required unless the cover was asked for; both is a
    // contradiction rather than a preference, and answering one of them would
    // be guessing at the caller's intent.
    if (!SAFE.test(token)) return notFound;
    if (wantsCover ? itemId !== '' : !SAFE.test(itemId)) return notFound;

    try {
        const db = initAdmin().firestore();

        // 0. Throttle before doing any work. Both checks fail OPEN — this
        //    protects against cost and noise, not against a breach, and a
        //    limiter that fails closed turns a database blip into a restaurant
        //    whose customers cannot see the menu.
        const burst = await consume(db, {
            key: ipKey(clientIp(event.headers || {})),
            limit: IP_BURST_LIMIT,
            windowSeconds: IP_BURST_SECONDS
        });
        if (!burst.allowed) return tooManyRequests(burst, cors);

        const daily = await consume(db, {
            key: `tok_${token}`, limit: TOKEN_DAILY_LIMIT, windowSeconds: DAY_SECONDS
        });
        if (!daily.allowed) return tooManyRequests(daily, cors);

        // 1. The token names a table, and the table names a workspace. Deny-all
        //    to clients, so this mapping only exists server-side.
        const dirSnap = await db.doc(`pos_table_directory/${token}`).get();
        if (!dirSnap.exists) return notFound;
        const dir = dirSnap.data() || {};
        // A REVOKED entry is a token whose card is out in the world and must
        // stop working: the table was archived, or the token was rotated. The
        // entry is kept rather than deleted precisely so this check exists — a
        // deleted entry and a token that was never issued look identical, so a
        // re-issued token could silently resurrect a card somebody printed and
        // threw away. See scripts/sync-pos-table-directory.js.
        if (dir.revoked === true) return notFound;
        const workspaceId = dir.workspace_id;
        if (!workspaceId) return notFound;

        // 2a. The OUTLET's header photo. Scoped to the outlet this table
        //     belongs to, which the directory already knows — a token for table
        //     4 cannot ask for another outlet's imagery.
        if (wantsCover) {
            const dimensionId = dir.dimension_id;
            if (!dimensionId || !SAFE.test(String(dimensionId))) return notFound;
            const cfgSnap = await db
                .doc(`workspaces/${workspaceId}/pos_outlet_settings/${dimensionId}`).get();
            if (!cfgSnap.exists) return notFound;
            const coverPath = typeof (cfgSnap.data() || {}).cover_image_path === 'string'
                ? cfgSnap.data().cover_image_path : '';
            if (!coverPath) return notFound;
            // Same belt and braces as the item path below: a string on a
            // document becomes a file read for an anonymous caller exactly here.
            if (!coverPath.startsWith(`workspaces/${workspaceId}/pos_outlets/${dimensionId}/`)) {
                return notFound;
            }
            const coverFile = initAdmin().storage().bucket().file(coverPath);
            const [coverUrl] = await coverFile.getSignedUrl({
                action: 'read', expires: Date.now() + URL_TTL_MS
            });
            return {
                statusCode: 302,
                headers: { ...cors, Location: coverUrl, 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
                body: ''
            };
        }

        // 2. The item, IN THAT WORKSPACE. This is the check a Storage rule
        //    cannot make: scoping a photo to the restaurant whose QR code was
        //    scanned, and to items actually on its menu.
        const itemSnap = await db.doc(`workspaces/${workspaceId}/items/${itemId}`).get();
        if (!itemSnap.exists) return notFound;
        const item = itemSnap.data() || {};
        if (item.pos_visible !== true) return notFound;
        if (item.status === 'archived') return notFound;
        const path = typeof item.image_path === 'string' ? item.image_path : '';
        if (!path) return notFound;

        // Belt and braces. `image_path` is written by our own DAL, but it is a
        // string on a document and this is the one place it becomes a file read
        // for an anonymous caller. A path outside this workspace's own tree is
        // refused rather than trusted.
        if (!path.startsWith(`workspaces/${workspaceId}/items/${itemId}/`)) return notFound;

        // 3. A signed URL with a life measured in minutes, and a redirect to it.
        const file = initAdmin().storage().bucket().file(path);
        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + URL_TTL_MS,
        });

        return {
            statusCode: 302,
            headers: {
                ...cors,
                Location: url,
                'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
            },
            body: '',
        };
    } catch (err) {
        // Logged, never returned. The message can name a workspace or a path.
        console.error('[qr-menu-image]', err && err.message);
        return notFound;
    }
};
