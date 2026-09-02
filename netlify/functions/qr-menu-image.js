'use strict';

const { allowOriginHeader } = require('./lib/allowed-origins');

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

    // One shape of refusal for every failure below. A customer holding a valid
    // token for table 4 must not be able to learn, from the difference between
    // two error messages, whether an item id exists in someone else's workspace.
    const notFound = { statusCode: 404, headers: { ...cors, 'Cache-Control': 'no-store' }, body: 'Not found' };

    if (!SAFE.test(token) || !SAFE.test(itemId)) return notFound;

    try {
        const db = initAdmin().firestore();

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
