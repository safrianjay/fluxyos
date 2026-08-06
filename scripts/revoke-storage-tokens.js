// =============================================================================
// FluxyOS — revoke every Firebase Storage download token
//
// THIS IS THE STEP THAT ACTUALLY CLOSES THE HOLE. The code change stops NEW
// public links being minted; this kills the ones already out there.
//
// Background. getDownloadURL() stamps a token into an object's metadata and
// returns:
//
//   https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>?alt=media&token=<uuid>
//
// Firebase serves that URL over public HTTPS with Storage Security Rules
// BYPASSED. Verified against production: a plain HTTP GET with no browser, no
// cookies and no auth returned 200 and the full file. Every attachment ever
// previewed in FluxyOS has such a token, and tokens never expire.
//
// Clearing the `firebaseStorageDownloadTokens` metadata key invalidates every
// link previously issued for that object, immediately and permanently.
//
// DESTRUCTIVE AND IRREVERSIBLE for anyone holding an old link — which is the
// entire point. Any URL pasted into a chat, an email or a bookmark stops
// working. Tell the team before running it.
//
// Usage:
//   # 1) Dry run — counts objects per prefix, writes nothing:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/revoke-storage-tokens.js --dry-run
//
//   # 2) Revoke for real:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/revoke-storage-tokens.js
//
// Run this AFTER the app code that fetches bytes through the SDK is deployed,
// or live users lose their previews until they reload.
// =============================================================================

const admin = require('firebase-admin');

const DRY_RUN = process.argv.includes('--dry-run');

// Every prefix storage.rules grants read on. Anything outside these is already
// denied by the catch-all `match /{allPaths=**} { allow read, write: if false }`.
const PREFIXES = [
    'workspaces/',   // documents/ + bank_statement_imports/ (shared, current)
    'users/'         // documents/ + bank_statement_imports/ + legacy receipts/
];

function initAdmin() {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key.');
        process.exit(1);
    }
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'fluxyos.firebasestorage.app'
        });
    }
    return admin.storage().bucket();
}

// Group a path into a reportable bucket so the dry run is readable.
function classify(name) {
    if (name.includes('/documents/')) return 'documents';
    if (name.includes('/bank_statement_imports/')) return 'bank_statements';
    if (name.includes('/receipts/')) return 'legacy_receipts';
    return 'other';
}

(async () => {
    const bucket = initAdmin();
    console.log(`Bucket: ${bucket.name}`);
    console.log(DRY_RUN ? 'MODE: dry run — nothing will be written\n' : 'MODE: REVOKING — old links die immediately\n');

    const counts = {};
    const withToken = {};
    let scanned = 0;
    let revoked = 0;
    let failed = 0;

    for (const prefix of PREFIXES) {
        let pageToken;
        do {
            const [files, next] = await bucket.getFiles({ prefix, maxResults: 500, pageToken, autoPaginate: false });
            pageToken = next?.pageToken;

            for (const file of files) {
                scanned += 1;
                const group = classify(file.name);
                counts[group] = (counts[group] || 0) + 1;

                // Only objects that actually carry a token are exposed.
                const token = file.metadata?.metadata?.firebaseStorageDownloadTokens;
                if (!token) continue;
                withToken[group] = (withToken[group] || 0) + 1;

                if (DRY_RUN) continue;
                try {
                    // Clearing the key is what kills every link already issued.
                    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: '' } });
                    revoked += 1;
                } catch (err) {
                    failed += 1;
                    console.error(`  FAILED ${file.name}: ${err.message}`);
                }
            }
        } while (pageToken);
    }

    console.log('Objects scanned by group:');
    Object.keys(counts).sort().forEach((k) => {
        console.log(`  ${k.padEnd(18)} ${String(counts[k]).padStart(6)}   with public token: ${String(withToken[k] || 0).padStart(6)}`);
    });
    const exposed = Object.values(withToken).reduce((a, b) => a + b, 0);
    console.log(`\nTotal scanned: ${scanned}`);
    console.log(`Publicly reachable right now: ${exposed}`);
    if (DRY_RUN) {
        console.log('\nDry run only. Re-run without --dry-run to revoke.');
    } else {
        console.log(`Revoked: ${revoked}${failed ? `  ·  FAILED: ${failed}` : ''}`);
        console.log('\nEvery previously-issued download link is now dead.');
    }
    process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
