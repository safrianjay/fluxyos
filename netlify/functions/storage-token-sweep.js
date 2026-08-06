'use strict';

// Nightly sweep that strips Firebase Storage public download tokens (02:30 WIB).
//
// Why this has to exist as a recurring job rather than an upload-path fix:
// Firebase stamps `firebaseStorageDownloadTokens` server-side when an object is
// created. A request carrying that token is served over public HTTPS with
// Storage Security Rules BYPASSED — verified against production, where a plain
// GET with no browser, no cookies and no auth returned 200 and the whole file.
//
// The client cannot prevent it. Passing the reserved key in customMetadata makes
// the upload fail outright; a follow-up updateMetadata() is rejected with
// storage/unknown. Only the Admin SDK can clear it. See docs/SECURITY_SYSTEM.md
// §11b — do not "fix" this in db-service.js, both routes were tried.
//
// The app itself never asks for or surfaces a token (getDownloadURL is gone;
// reads go through getDocumentBlob under storage.rules), and the client cannot
// even READ the key, so this is defence in depth rather than the primary
// control. It closes the window in which an Admin-SDK or GCS-level reader could
// mint a permanent public link out of a freshly uploaded file.
//
// Read-mostly: it only ever clears that one metadata key. It never reads file
// contents, never deletes an object, and never touches Firestore.
//
// Same manual equivalent: scripts/revoke-storage-tokens.js.
const { schedule } = require('@netlify/functions');
const admin = require('firebase-admin');

// Bound a single run so one enormous tenant cannot stall the whole sweep; the
// remainder is picked up the next night. Ordered oldest-first is not possible
// on a bucket listing, so an unswept tail simply waits a day — acceptable,
// because the token is only reachable with credentials that already grant more.
const MAX_OBJECTS = 5000;

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'fluxyos.firebasestorage.app';

function initStorage() {
    if (!admin.apps.length) {
        const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
        if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
        admin.initializeApp({
            credential: admin.credential.cert(JSON.parse(raw)),
            storageBucket: BUCKET
        });
    }
    // initAdmin() in lib/notify-core.js does not set a storageBucket, so the
    // bucket is named explicitly here rather than relying on the default.
    return admin.storage().bucket(BUCKET);
}

// The cron that actually registers is the one in netlify.toml — the in-code
// wrapper silently failed to register for ledger-integrity-sweep. Keep the two
// in step; changing one alone is how a sweep stops running unnoticed.
exports.handler = schedule('0 19 * * *', async () => {
    // Default-off kill switch, matching every other sweep here. NOTE: while this
    // is unset the sweep does nothing, so new uploads keep their tokens. Set
    // STORAGE_TOKEN_SWEEP_ENABLED=true on the app site to arm it.
    if (process.env.STORAGE_TOKEN_SWEEP_ENABLED !== 'true') {
        console.log('storage-token-sweep skipped: STORAGE_TOKEN_SWEEP_ENABLED !== "true"');
        return { statusCode: 200, body: 'disabled' };
    }

    let bucket;
    try {
        bucket = initStorage();
    } catch (err) {
        console.error('storage-token-sweep could not initialise:', err.message);
        return { statusCode: 500, body: 'init_failed' };
    }

    let scanned = 0;
    let revoked = 0;
    let failed = 0;
    let pageToken;

    try {
        do {
            const [files, next] = await bucket.getFiles({
                maxResults: 500, pageToken, autoPaginate: false
            });
            pageToken = next?.pageToken;

            for (const file of files) {
                if (scanned >= MAX_OBJECTS) { pageToken = null; break; }
                scanned += 1;
                if (!file.metadata?.metadata?.firebaseStorageDownloadTokens) continue;
                try {
                    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: '' } });
                    revoked += 1;
                } catch (err) {
                    failed += 1;
                    console.error(`storage-token-sweep failed on ${file.name}: ${err.message}`);
                }
            }
        } while (pageToken);
    } catch (err) {
        console.error('storage-token-sweep aborted:', err.message);
        return { statusCode: 500, body: JSON.stringify({ scanned, revoked, failed, error: err.message }) };
    }

    // Revoked > 0 is the normal steady state: it is the count of files uploaded
    // since the last sweep. A sudden spike is worth a look; zero means nobody
    // uploaded anything.
    console.log(`storage-token-sweep: scanned=${scanned} revoked=${revoked} failed=${failed}`);
    return { statusCode: 200, body: JSON.stringify({ scanned, revoked, failed }) };
});
