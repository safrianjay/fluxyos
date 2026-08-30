'use strict';

const { ALLOWED_ORIGINS } = require('./lib/allowed-origins');

// Short-lived signed URLs for a user's KYC documents, for the Internal
// Operations Console (internal.html → KYC Review → Review KYC → Documents).
//
// Why a server function: the documents live at users/{uid}/kyc/{docType}/... in
// Firebase Storage, and storage.rules only grants read to that same signed-in
// uid. The console is credential-gated, NOT signed in as the target user, so it
// cannot read them from the browser. This endpoint uses the Admin SDK (bypasses
// rules) to mint a time-limited signed URL.
//
// The alternative — opening storage.rules for reviewers — would mean any signed
// in user could craft a read for someone else's identity document, so it is not
// on the table.
//
// Auth: same MVP posture as extend-trial / send-lead-outreach — the console has
// no Firebase Auth, so this is gated by the shared INTERNAL_API_TOKEN in the
// `x-internal-token` header. NOT production-grade; move to a server-verified
// admin session with the rest of the console.
const admin = require('firebase-admin');

const ALLOWED = ALLOWED_ORIGINS;
// Deliberately short: long enough for a reviewer to open the document, short
// enough that a leaked URL in a log or chat is dead within the hour.
const URL_TTL_MS = 10 * 60 * 1000;
const DOC_TYPES = { identity: 'identity_document_storage_path', business: 'business_document_storage_path' };

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

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    const cors = {
        'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : 'https://fluxyos.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-internal-token',
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method not allowed' };

    const expected = process.env.INTERNAL_API_TOKEN;
    const provided = (event.headers && (event.headers['x-internal-token'] || event.headers['X-Internal-Token'])) || '';
    if (!expected || provided !== expected) {
        return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'unauthorized' }) };
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (_) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_json' }) }; }

    const userId = str(body.userId, 160);
    const docType = str(body.docType, 20);
    if (!userId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'userId_required' }) };
    if (!DOC_TYPES[docType]) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_doc_type' }) };

    try {
        const sdk = initAdmin();
        const snap = await sdk.firestore().doc(`users/${userId}/onboarding/documents`).get();
        if (!snap.exists) {
            return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'no_documents' }) };
        }
        const storagePath = snap.data()[DOC_TYPES[docType]];
        if (!storagePath) {
            return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'not_uploaded' }) };
        }
        // Never trust a stored path blindly — confirm it is inside THIS user's own
        // KYC prefix before signing, so a corrupted or tampered field can't be
        // turned into a read of some other object in the bucket.
        const expectedPrefix = `users/${userId}/kyc/${docType}/`;
        if (!String(storagePath).startsWith(expectedPrefix)) {
            return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'path_mismatch' }) };
        }

        const [url] = await sdk.storage().bucket().file(storagePath).getSignedUrl({
            action: 'read',
            expires: Date.now() + URL_TTL_MS,
        });
        return {
            statusCode: 200,
            headers: { ...cors, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url,
                fileName: snap.data()[`${docType}_document_file_name`] || null,
                expiresInSeconds: Math.floor(URL_TTL_MS / 1000),
            }),
        };
    } catch (e) {
        console.error('[kyc-document-url] failed:', e && e.message ? e.message : e);
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'server_error' }) };
    }
};
