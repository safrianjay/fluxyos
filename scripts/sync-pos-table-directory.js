// =============================================================================
// FluxyOS — reconcile pos_table_directory from pos_tables
//
// WHAT THIS IS FOR.
//
// `pos_table_directory/{token}` maps a QR token to the table it was printed for:
// `{ workspace_id, table_id, dimension_id, revoked }`. It is `allow read, write:
// if false` for **every** client including the owner, so a guessed token cannot
// even confirm a workspace exists — and the customer surface costs zero rules
// budget because it never touches Firestore.
//
// It shipped with rules and a design and **nothing ever wrote it**. Every QR
// endpoint resolves through it, so until it is populated the customer surface is
// correct and unreachable — including `netlify/functions/qr-menu-image.js`.
//
// This is the reconcile. It is a projection of `pos_tables`, so it can be
// rebuilt at any time and re-running it is idempotent.
//
// WHY A SCRIPT AND NOT A TRIGGER. Firestore triggers are Cloud Functions and
// this project has none — the backend is Netlify Functions, which are HTTP and
// cannot watch a collection. A table is created once when a restaurant sets up
// its floor and rarely after, so a reconcile is proportionate.
//
// ⚠️ THE INTENDED LONG-TERM PATH IS DIFFERENT, and worth writing down before
// someone wires this to a cron and calls it done: the directory entry should be
// written **when the QR is generated**, not on a schedule. A QR cannot exist in
// the world before somebody generates and prints it, and that is a deliberate
// action which can call an authenticated function. Registering there means no
// sync window, and a directory that contains only tables whose codes are
// actually out there. This script then becomes what its name says — a
// reconcile — rather than the mechanism.
//
// WHAT IT DOES
//
//   active table + token      → upsert   { workspace_id, table_id, dimension_id, revoked: false }
//   archived table            → REVOKE   the printed card stops resolving
//   token rotated             → REVOKE the old entry; upsert the new one
//   active table, no token    → mint one (--commit), so its QR can exist at all
//
// REVOKED, NEVER DELETED. A deleted entry and a token that was never issued are
// indistinguishable, so a re-issued token could silently resurrect a card
// somebody printed and threw away. `revoked: true` is a fact the resolver can
// refuse on, and `qr-menu-image.js` does.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/sync-pos-table-directory.js
//   ... --workspace <wsId>
//   ... --commit            (default is a DRY RUN — nothing is written)
// =============================================================================

const crypto = require('crypto');
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const argVal = (name, def = null) => {
    const i = args.indexOf(name);
    return (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : def;
};
const ONLY_WS = argVal('--workspace');
const COMMIT = args.includes('--commit');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key first.');
    process.exit(1);
}
if (!admin.apps.length) admin.initializeApp({ projectId: 'fluxyos' });
const db = admin.firestore();

// The same shape `_newQrToken` produces in the DAL: 256 bits of CSPRNG output,
// base64url. Never derived from the table id, a sequence or a timestamp — a
// guessable token is a readable menu and a submittable order for someone else's
// business.
const newToken = () => crypto.randomBytes(32).toString('base64url');

const plan = { upsert: [], revoke: [], mint: [], skipped: [] };

async function collectWorkspace(wsId) {
    const snap = await db.collection(`workspaces/${wsId}/pos_tables`).get();
    if (snap.empty) return;

    for (const doc of snap.docs) {
        const t = { id: doc.id, ...doc.data() };
        const archived = t.status === 'archived';
        let token = typeof t.qr_token === 'string' ? t.qr_token : '';

        if (!token) {
            if (archived) { plan.skipped.push(`${wsId}/${t.id} archived, no token`); continue; }
            // Tables created before `qr_token` existed carry none, so their QR
            // could never be generated. Minting one here is the only thing that
            // makes those tables reachable at all.
            token = newToken();
            plan.mint.push({ wsId, tableId: t.id, label: t.label || t.id, token });
        }

        if (archived) {
            plan.revoke.push({ token, why: `${wsId}/${t.label || t.id} is archived` });
            continue;
        }
        plan.upsert.push({
            token,
            wsId,
            tableId: t.id,
            label: t.label || t.id,
            dimensionId: t.dimension_id || null
        });
    }
}

(async () => {
    const wsIds = ONLY_WS
        ? [ONLY_WS]
        : (await db.collection('workspaces').get()).docs.map((d) => d.id);

    for (const wsId of wsIds) {
        try { await collectWorkspace(wsId); }
        catch (err) { console.error(`  ! ${wsId}: ${err.message}`); }
    }

    // Entries that point at a table whose CURRENT token is different. That is a
    // rotation: the old card is in somebody's hand and must stop working, or
    // rotating a token would be cosmetic.
    const live = new Map(plan.upsert.map((u) => [u.token, u]));
    const dirSnap = await db.collection('pos_table_directory').get();
    dirSnap.docs.forEach((d) => {
        const cur = d.data() || {};
        if (live.has(d.id)) return;                       // still the current token
        if (cur.revoked === true) return;                 // already dead
        if (ONLY_WS && cur.workspace_id !== ONLY_WS) return;
        // Reached only by an entry whose token no table currently carries.
        plan.revoke.push({ token: d.id, why: `token rotated or table removed (${cur.workspace_id || '?'})` });
    });

    console.log('\nPOS TABLE DIRECTORY — RECONCILE\n');
    console.log(`  workspaces scanned : ${wsIds.length}`);
    console.log(`  upsert             : ${plan.upsert.length}`);
    console.log(`  revoke             : ${plan.revoke.length}`);
    console.log(`  tokens to mint     : ${plan.mint.length}`);
    if (plan.skipped.length) console.log(`  skipped            : ${plan.skipped.length}`);

    plan.mint.slice(0, 10).forEach((m) => console.log(`    mint  ${m.wsId}/${m.label}`));
    plan.revoke.slice(0, 10).forEach((r) => console.log(`    revoke ${r.token.slice(0, 8)}…  ${r.why}`));

    if (!COMMIT) {
        console.log('\nDry run — nothing written. Re-run with --commit to apply.\n');
        process.exit(0);
    }

    // Batched, 400 at a time: Firestore caps a batch at 500 writes and a minted
    // token costs two (the table and the directory entry).
    let batch = db.batch();
    let n = 0;
    const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };

    for (const m of plan.mint) {
        batch.update(db.doc(`workspaces/${m.wsId}/pos_tables/${m.tableId}`), {
            qr_token: m.token, updated_at: new Date()
        });
        if (++n >= 400) await flush();
    }
    for (const u of plan.upsert) {
        batch.set(db.doc(`pos_table_directory/${u.token}`), {
            workspace_id: u.wsId,
            table_id: u.tableId,
            dimension_id: u.dimensionId,
            revoked: false,
            updated_at: new Date()
        }, { merge: true });
        if (++n >= 400) await flush();
    }
    for (const r of plan.revoke) {
        // merge, so an entry this run did not build keeps whatever it had.
        batch.set(db.doc(`pos_table_directory/${r.token}`), {
            revoked: true, updated_at: new Date()
        }, { merge: true });
        if (++n >= 400) await flush();
    }
    await flush();

    console.log(`\nDone. ${plan.upsert.length} live, ${plan.revoke.length} revoked, ${plan.mint.length} tokens minted.\n`);
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
