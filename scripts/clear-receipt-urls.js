// =============================================================================
// FluxyOS — clear the persisted public URLs from transactions.receipt_url
//
// receipt_url stored the output of getDownloadURL(): a permanent PUBLIC link to
// a receipt image. Because it lived in Firestore, the leak outlived the page,
// travelled with the record, and was readable by every workspace member, every
// export and anything with database read access.
//
// The attachment itself is not lost — attached_documents already carries the
// storage_path, which is now fetched through authorised bytes. This field is
// pure duplicated exposure.
//
// Run AFTER scripts/revoke-storage-tokens.js, so a stale field never outlives a
// live token. (Order matters only for the window between the two; running this
// first would leave the tokens live with the URLs merely harder to find, which
// is security theatre.)
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/clear-receipt-urls.js --dry-run
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/clear-receipt-urls.js
// =============================================================================

const admin = require('firebase-admin');

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_LIMIT = 400;   // Firestore caps a batch at 500 writes

function initAdmin() {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key.');
        process.exit(1);
    }
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

// Both scopes: workspaces/ is where finance data lives now, users/ still holds
// the pre-migration copy that the rollback net depends on. A public URL in the
// old copy is just as readable, so clear both.
async function scopeRoots(db) {
    const roots = [];
    for (const [col, label] of [['workspaces', 'workspace'], ['users', 'user']]) {
        const snap = await db.collection(col).select().get();
        snap.docs.forEach((d) => roots.push({ path: `${col}/${d.id}`, label, id: d.id }));
    }
    return roots;
}

(async () => {
    const db = initAdmin();
    console.log(DRY_RUN ? 'MODE: dry run — nothing will be written\n' : 'MODE: CLEARING receipt_url\n');

    const roots = await scopeRoots(db);
    let scanned = 0;
    let toClear = 0;
    let cleared = 0;
    const perScope = [];

    for (const root of roots) {
        const snap = await db.collection(`${root.path}/transactions`)
            .where('receipt_url', '!=', null)
            .select('receipt_url')
            .get()
            .catch(() => null);
        if (!snap || snap.empty) continue;

        scanned += snap.size;
        const hits = snap.docs.filter((d) => {
            const v = d.get('receipt_url');
            return typeof v === 'string' && v.length > 0;
        });
        if (!hits.length) continue;
        toClear += hits.length;
        perScope.push(`  ${root.label.padEnd(10)} ${root.id.slice(0, 12).padEnd(14)} ${String(hits.length).padStart(5)}`);

        if (DRY_RUN) continue;
        for (let i = 0; i < hits.length; i += BATCH_LIMIT) {
            const batch = db.batch();
            hits.slice(i, i + BATCH_LIMIT).forEach((d) => {
                // Delete the field rather than writing null: the transaction
                // update validator accepts the key absent, and an absent key
                // cannot be mistaken for "we stored an empty URL".
                batch.update(d.ref, { receipt_url: admin.firestore.FieldValue.delete() });
            });
            await batch.commit();
            cleared += Math.min(BATCH_LIMIT, hits.length - i);
        }
    }

    if (perScope.length) {
        console.log('Transactions carrying a public receipt_url:');
        perScope.forEach((l) => console.log(l));
    }
    console.log(`\nScanned: ${scanned}`);
    console.log(`Carrying a public URL: ${toClear}`);
    if (DRY_RUN) console.log('\nDry run only. Re-run without --dry-run to clear.');
    else console.log(`Cleared: ${cleared}`);
    process.exit(0);
})().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
